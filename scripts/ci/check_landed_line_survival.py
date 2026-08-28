#!/usr/bin/env python3
"""Check that the work of a merged pull request is still in the tree.

Issue #541. A squash merge writes whole files. A squash from a branch that was
cut before an earlier pull request landed therefore DELETES that pull request's
work, and it leaves the deleted pull request in the history. Pull request #502
corrected the logout flight and its journey. Pull request #516 merged four
hours later from a stale branch and restored the five files to their pre-#502
copies, byte for byte.

The check that was run then was:

    git merge-base --is-ancestor <the pull request> <the head>   -> true

That answer is correct and it is not evidence. Ancestry reports the commit.
It says nothing about the content. This checker reads the content.

WHAT IT DOES

It walks the first-parent chain of a tip commit. Each commit on that chain is
one merged pull request. For each of them it takes the diff against the
commit's own parent, which is the base the pull request merged onto, and it
looks for the lines the pull request added in the tree at the tip.

It reports three states per file, and only the first two are faults:

  restored  A later commit set the file back to its EXACT byte content from
            before the pull request, and lines the pull request added are
            still missing at the tip. This is the #502 signature. It needs no
            threshold and no judgement: the blob object id matches.

  reverted  At the tip NONE of the lines the pull request added are present,
            and EVERY measurable line of the file AS IT WAS BEFORE the pull
            request is present again. The old text came back whole, without a
            byte-exact match, because a later commit edited the file as well.

  rewritten The added lines are gone, and the removed lines did not come back.
            An ordinary rewrite, a regeneration or a deliberate removal looks
            like this. The checker PRINTS these and does not fail on them.

For each fault it names the pull request that added the work AND the pull
request that deleted it, because the second one is the one to fix.

WHAT IT CANNOT SEE

- A file that the tip does not hold. A rename and a deletion both look like a
  total loss, and both are usually deliberate, so the checker skips the path.
- A binary file, and a file that does not decode as UTF-8.
- Short lines, blank lines and comment-only lines. A brace or an import is
  common text, so its presence at the tip proves nothing.
- A loss inside a pull request that never reached the trunk as its own commit.
  This repository squashes, and it has also landed several pull requests in one
  trunk commit. The checker measures what the trunk holds.

WHY IT CANNOT FAIL THE PULL REQUEST THAT RUNS IT

The tip is a COMMIT, and the workflow passes the base branch head. The tree
under review never enters the measurement, so a pull request that legitimately
rewrites lines an earlier pull request added cannot make this checker red. The
checker therefore reports a fault that ALREADY merged. It turns a silent
deletion into a red check on the next pull request, and it names the merge that
made it.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from typing import Dict, List, Optional, Sequence, Tuple

# A line must carry this much text before its absence means anything. A brace,
# a bracket or a one-word statement appears everywhere.
MIN_LINE_LENGTH = 12
MIN_ALNUM_CHARS = 3

# A "reverted" verdict needs this many measurable added lines. Below it the
# sample is too small to separate a stale squash from an edit.
MIN_ADDED_FOR_REVERT = 3

# A "reverted" verdict also needs this much of the file from BEFORE the pull
# request back at the tip. A first version asked only that the lines the pull
# request REMOVED came back, and that rule called one honest replacement a
# fault: pull request #202 replaced a 160-line end-to-end stub with the real
# 56-line admin entry, and the single line #82 had removed was in it. Ask for
# the whole old file instead. Only a revert brings that back.
MIN_OLD_TEXT_BACK = 1.0

# A comment carries no behaviour, and comment text repeats across files.
COMMENT_PREFIXES = ("//", "#", "*", "/*", "--", "<!--", ";", '"""', "'''")

DEFAULT_LIMIT = 40
DEFAULT_ALLOWLIST = "scripts/ci/landed-line-survival-allowlist.txt"

PR_NUMBER = re.compile(r"#(\d+)")


class GitError(RuntimeError):
    pass


def git(repo: str, *args: str) -> str:
    """Run git and return stdout. Raise on a non-zero exit.

    Decode with `errors="replace"`. A tracked file can hold bytes that are not
    UTF-8 while git still treats it as text, and a diff that carries one of
    those bytes must not stop the whole walk. A replaced byte can only make a
    line look unfamiliar, which this checker already treats as a rewrite and
    not as a fault.
    """
    proc = subprocess.run(
        ["git", "-C", repo, *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if proc.returncode != 0:
        raise GitError(
            "git %s failed: %s"
            % (" ".join(args), proc.stderr.decode("utf-8", "replace").strip())
        )
    return proc.stdout.decode("utf-8", "replace")


def git_ok(repo: str, *args: str) -> bool:
    """Run git and report only whether it succeeded."""
    proc = subprocess.run(
        ["git", "-C", repo, *args],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return proc.returncode == 0


class BlobReader:
    """Read blobs through one long-lived `git cat-file --batch` process.

    The checker reads the same files many times. One process removes several
    thousand `git show` invocations.
    """

    def __init__(self, repo: str) -> None:
        self._proc = subprocess.Popen(
            ["git", "-C", repo, "cat-file", "--batch"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
        )
        self._cache: Dict[str, Optional[str]] = {}

    def close(self) -> None:
        if self._proc.stdin is not None:
            self._proc.stdin.close()
        self._proc.wait()

    def text(self, oid: str) -> Optional[str]:
        """Return the blob as text. Return None for a missing or binary blob."""
        if oid in self._cache:
            return self._cache[oid]
        assert self._proc.stdin is not None and self._proc.stdout is not None
        self._proc.stdin.write(("%s\n" % oid).encode())
        self._proc.stdin.flush()
        header = self._proc.stdout.readline().decode(errors="replace").strip()
        if header.endswith(" missing") or " blob " not in header:
            self._cache[oid] = None
            return None
        size = int(header.rsplit(" ", 1)[1])
        payload = self._proc.stdout.read(size)
        self._proc.stdout.read(1)  # the trailing newline cat-file adds
        try:
            value: Optional[str] = payload.decode("utf-8")
        except UnicodeDecodeError:
            value = None
        self._cache[oid] = value
        return value


def measurable(line: str) -> bool:
    """Report whether the absence of this line means anything."""
    text = line.strip()
    if len(text) < MIN_LINE_LENGTH:
        return False
    if text.startswith(COMMENT_PREFIXES):
        return False
    if sum(1 for char in text if char.isalnum()) < MIN_ALNUM_CHARS:
        return False
    return True


def pull_request_number(subject: str) -> Optional[str]:
    """Return the pull request that merged the commit.

    A subject can name several issues and then its own pull request, as in
    "... (#602, #603, #604) (#605)". The merging pull request is the last one.
    """
    found = PR_NUMBER.findall(subject)
    return found[-1] if found else None


def raw_changes(repo: str, commit: str) -> List[Tuple[str, str, str]]:
    """Return (path, source blob, destination blob) for each changed file.

    `git diff --raw -z` is the authoritative list. It never quotes a path, so a
    path that holds a space or a quote survives it intact.

    `--abbrev=40` is load-bearing. `--raw` abbreviates a blob object id by
    default, and an abbreviated id never equals the full id that `rev-parse`
    returns. The exact-blob comparison that finds a restored file then always
    answers "no", and so does the test for the empty object id.
    """
    out = git(
        repo,
        "diff",
        "--raw",
        "--abbrev=40",
        "--no-renames",
        "--no-ext-diff",
        "-z",
        "%s^" % commit,
        commit,
    )
    fields = out.split("\0")
    changes: List[Tuple[str, str, str]] = []
    index = 0
    while index < len(fields):
        meta = fields[index]
        if not meta.startswith(":"):
            index += 1
            continue
        parts = meta[1:].split(" ")
        if len(parts) < 5:
            index += 2
            continue
        source_blob, destination_blob = parts[2], parts[3]
        path = fields[index + 1] if index + 1 < len(fields) else ""
        if path:
            changes.append((path, source_blob, destination_blob))
        index += 2
    return changes


def is_null_oid(oid: str) -> bool:
    """Report whether the raw diff wrote the empty object id.

    The empty id marks a file the commit created or deleted. It is all zeroes
    at whatever width the caller asked for.
    """
    return oid != "" and set(oid) == {"0"}


def diff_lines(
    repo: str, commit: str, known_paths: Sequence[str]
) -> Dict[str, Tuple[List[str], List[str]]]:
    """Return the added and removed lines of each file the commit changed.

    One diff covers the whole commit. The path comes out of the `+++`/`---`
    header, and a path the raw list does not hold is dropped rather than
    guessed: git quotes an unusual path in that header.
    """
    out = git(
        repo,
        "-c",
        "core.quotepath=false",
        "diff",
        "--unified=0",
        "--no-renames",
        "--no-color",
        "--no-ext-diff",
        "%s^" % commit,
        commit,
    )
    wanted = set(known_paths)
    result: Dict[str, Tuple[List[str], List[str]]] = {}
    path: Optional[str] = None
    for line in out.splitlines():
        if line.startswith("diff --git "):
            path = None
            continue
        if line.startswith("--- ") or line.startswith("+++ "):
            candidate = line[4:]
            if candidate == "/dev/null":
                continue
            if candidate.startswith(("a/", "b/")):
                candidate = candidate[2:]
            if candidate in wanted:
                path = candidate
                result.setdefault(path, ([], []))
            continue
        if path is None:
            continue
        if line.startswith("+++") or line.startswith("---"):
            continue
        if line.startswith("+"):
            result[path][0].append(line[1:])
        elif line.startswith("-"):
            result[path][1].append(line[1:])
    return result


def tip_blobs(repo: str, tip: str) -> Dict[str, str]:
    """Return the blob object id of every file in the tip tree."""
    out = git(repo, "ls-tree", "-r", "-z", tip)
    blobs: Dict[str, str] = {}
    for record in out.split("\0"):
        if not record:
            continue
        meta, _, path = record.partition("\t")
        parts = meta.split(" ")
        if len(parts) >= 3 and parts[1] == "blob":
            blobs[path] = parts[2]
    return blobs


class Finding:
    def __init__(
        self,
        verdict: str,
        pull_request: Optional[str],
        commit: str,
        subject: str,
        path: str,
        missing: List[str],
        added_count: int,
    ) -> None:
        self.verdict = verdict
        self.pull_request = pull_request
        self.commit = commit
        self.subject = subject
        self.path = path
        self.missing = missing
        self.added_count = added_count
        self.culprit_commit: Optional[str] = None
        self.culprit_subject: str = ""
        self.culprit_pull_request: Optional[str] = None


def find_culprit(
    repo: str,
    reader: BlobReader,
    finding: Finding,
    tip: str,
    pre_blob: str,
) -> None:
    """Name the commit that deleted the work.

    It walks forward from the pull request to the tip over the commits that
    touched the file, and it stops at the first one that holds none of the
    missing lines. That commit is the merge to fix.
    """
    out = git(
        repo,
        "log",
        "--first-parent",
        "--reverse",
        "--format=%H%x1f%s",
        "%s..%s" % (finding.commit, tip),
        "--",
        finding.path,
    )
    for record in out.splitlines():
        if not record:
            continue
        sha, _, subject = record.partition("\x1f")
        try:
            blob = git(repo, "rev-parse", "--verify", "%s:%s" % (sha, finding.path)).strip()
        except GitError:
            continue
        if blob == pre_blob:
            gone = True
        else:
            content = reader.text(blob)
            if content is None:
                continue
            gone = all(line not in content for line in finding.missing)
        if gone:
            finding.culprit_commit = sha
            finding.culprit_subject = subject
            finding.culprit_pull_request = pull_request_number(subject)
            return


def old_text_is_back(reader: "BlobReader", source_blob: str, tip_text: str) -> bool:
    """Report whether the file as it was BEFORE the pull request is back.

    It reads the pre-pull-request blob and looks for every measurable line of
    it in the tree at the tip. A file the pull request created has no such
    blob, and it cannot be reverted, so the answer is False.
    """
    if not source_blob:
        return False
    old = reader.text(source_blob)
    if old is None:
        return False
    old_lines = [line.strip() for line in old.splitlines() if measurable(line)]
    if not old_lines:
        return False
    back = sum(1 for line in old_lines if line in tip_text)
    return back >= MIN_OLD_TEXT_BACK * len(old_lines)


def load_allowlist(path: str) -> Dict[Tuple[str, str], str]:
    """Read the accepted (pull request, path) pairs.

    A missing file means an empty allowlist. That is the normal state.
    """
    entries: Dict[Tuple[str, str], str] = {}
    if not os.path.exists(path):
        return entries
    with open(path, "r", encoding="utf-8") as handle:
        for number, raw in enumerate(handle, start=1):
            line = raw.split("#", 1)[0].strip()
            if not line:
                continue
            parts = line.split(None, 1)
            if len(parts) != 2:
                raise SystemExit(
                    "%s:%d: expected '<pull request> <path>  # reason'" % (path, number)
                )
            entries[(parts[0].lstrip("#"), parts[1].strip())] = raw.strip()
    return entries


def audit(
    repo: str, tip: str, limit: int, allowlist: Dict[Tuple[str, str], str]
) -> Tuple[List[Finding], List[Finding], List[str], int, set]:
    """Measure the last `limit` merged pull requests below the tip.

    The fifth value holds the (pull request, path) key of EVERY finding,
    including the ones the allowlist silenced. The caller needs it to tell a
    silenced entry from an entry that matches nothing.
    """
    chain = [
        line
        for line in git(
            repo,
            "log",
            "--first-parent",
            "--format=%H%x1f%s",
            "-%d" % limit,
            tip,
        ).splitlines()
        if line
    ]
    reader = BlobReader(repo)
    at_tip = tip_blobs(repo, tip)
    faults: List[Finding] = []
    rewrites: List[Finding] = []
    audited_numbers: List[str] = []
    seen = set()
    try:
        for record in chain:
            sha, _, subject = record.partition("\x1f")
            if not git_ok(repo, "rev-parse", "--verify", "--quiet", "%s^" % sha):
                continue  # the root commit has no base to compare against
            number = pull_request_number(subject)
            if number:
                audited_numbers.append(number)
            changes = raw_changes(repo, sha)
            if not changes:
                continue
            paths = [path for path, _, _ in changes]
            per_file = diff_lines(repo, sha, paths)
            for path, source_blob, destination_blob in changes:
                if path not in at_tip:
                    continue  # renamed or deleted at the tip; see the header
                if is_null_oid(source_blob):
                    source_blob = ""
                if is_null_oid(destination_blob):
                    continue  # the pull request deleted the file
                lines = per_file.get(path)
                if lines is None:
                    continue  # binary, or a header this parser did not trust
                added = [line for line in lines[0] if measurable(line)]
                if not added:
                    continue
                tip_text = reader.text(at_tip[path])
                if tip_text is None:
                    continue  # binary at the tip
                # Compare stripped text. Indentation moves for reasons that are
                # not a loss, and every later comparison uses this same form.
                missing = [
                    line.strip() for line in added if line.strip() not in tip_text
                ]
                if not missing:
                    continue

                restored = False
                if source_blob:
                    out = git(
                        repo,
                        "log",
                        "--first-parent",
                        "--format=%H",
                        "%s..%s" % (sha, tip),
                        "--",
                        path,
                    )
                    for later in out.splitlines():
                        if not later:
                            continue
                        try:
                            blob = git(
                                repo, "rev-parse", "--verify", "%s:%s" % (later, path)
                            ).strip()
                        except GitError:
                            continue
                        if blob == source_blob:
                            restored = True
                            break

                if restored:
                    verdict = "restored"
                elif (
                    len(missing) == len(added)
                    and len(added) >= MIN_ADDED_FOR_REVERT
                    and old_text_is_back(reader, source_blob, tip_text)
                ):
                    verdict = "reverted"
                elif len(missing) == len(added):
                    verdict = "rewritten"
                else:
                    continue  # part of the work survives; an ordinary edit

                finding = Finding(
                    verdict, number, sha, subject, path, missing, len(added)
                )
                seen.add((str(number), path))
                if verdict == "rewritten":
                    rewrites.append(finding)
                    continue
                if (str(number), path) in allowlist:
                    continue
                find_culprit(repo, reader, finding, tip, source_blob)
                faults.append(finding)
    finally:
        reader.close()
    return faults, rewrites, audited_numbers, len(chain), seen


def report(finding: Finding) -> None:
    label = "PR #%s" % finding.pull_request if finding.pull_request else finding.commit[:8]
    print("  %s  %s" % (finding.verdict.upper(), finding.path))
    print(
        "    added by   %s (%s) %s"
        % (label, finding.commit[:8], finding.subject[:80])
    )
    if finding.culprit_commit:
        culprit = (
            "PR #%s" % finding.culprit_pull_request
            if finding.culprit_pull_request
            else finding.culprit_commit[:8]
        )
        print(
            "    deleted by %s (%s) %s"
            % (culprit, finding.culprit_commit[:8], finding.culprit_subject[:80])
        )
    else:
        print("    deleted by an unnamed commit; the file changed outside the chain")
    print(
        "    %d of %d measurable added line(s) are gone, for example:"
        % (len(finding.missing), finding.added_count)
    )
    for line in finding.missing[:3]:
        print("      %s" % line.strip()[:110])


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", default=".", help="the repository to read")
    parser.add_argument(
        "--tip",
        default="HEAD",
        help="the commit whose tree holds the answer. Pass the BASE branch head "
        "on a pull request, so the tree under review stays out of the measurement.",
    )
    parser.add_argument(
        "--limit", type=int, default=DEFAULT_LIMIT, help="how many merged pull requests to read"
    )
    parser.add_argument("--allowlist", default=DEFAULT_ALLOWLIST)
    parser.add_argument(
        "--allow-shallow",
        action="store_true",
        help="read a shallow clone. The window is then whatever the clone holds.",
    )
    parser.add_argument(
        "--report-only",
        action="store_true",
        help="print the findings and exit 0. Use it to survey history.",
    )
    args = parser.parse_args(argv)

    repo = args.repo
    try:
        tip = git(repo, "rev-parse", "--verify", "%s^{commit}" % args.tip).strip()
    except GitError as error:
        print("::error::cannot resolve --tip %s: %s" % (args.tip, error))
        return 1

    if git(repo, "rev-parse", "--is-shallow-repository").strip() == "true":
        if not args.allow_shallow:
            print(
                "::error::the clone is shallow, so the trunk this check walks is not "
                "present. Check out with fetch-depth: 0, or pass --allow-shallow."
            )
            return 1

    allowlist = load_allowlist(os.path.join(repo, args.allowlist))
    faults, rewrites, audited_numbers, walked, seen = audit(
        repo, tip, args.limit, allowlist
    )

    print("tip            %s %s" % (tip[:8], git(repo, "log", "-1", "--format=%s", tip).strip()[:70]))
    print("audited        %d trunk commit(s), %d of them name a pull request" % (walked, len(audited_numbers)))

    # A window of zero measures nothing and would pass every run. Fail instead.
    if walked == 0:
        print("::error::the walk found no commit below the tip, so this check measured nothing")
        return 1
    if not audited_numbers:
        print(
            "::error::no audited commit names a pull request, so no merge can be "
            "named. The subject format changed, and this check measured nothing."
        )
        return 1

    # An allowlist entry rots. An entry whose pull request is still inside the
    # window, and which now matches nothing, states a removal that is no longer
    # there, so it is an error. An entry whose pull request left the window is
    # silent: the walk cannot see it any more, and that is not the entry's
    # fault.
    stale = []
    audited = set(audited_numbers)
    for key, raw in allowlist.items():
        if key[0] in audited and key not in seen:
            stale.append(raw)

    if rewrites:
        print()
        print("rewritten (reported, not a fault): %d file(s)" % len(rewrites))
        for finding in rewrites[:20]:
            print(
                "  %s  added by PR #%s, %d line(s) gone"
                % (finding.path, finding.pull_request, len(finding.missing))
            )
        if len(rewrites) > 20:
            print("  ... and %d more" % (len(rewrites) - 20))

    if faults:
        print()
        print("LOST WORK: %d file(s)" % len(faults))
        for finding in faults:
            report(finding)
        print()
        print(
            "::error::%d file(s) lost the work of a merged pull request. A squash "
            "from a stale branch writes whole files, so the merge named above "
            "deleted a fix that had already landed. Restore the work, then re-merge. "
            "Record an accepted removal in %s as '<pull request> <path>  # reason'."
            % (len(faults), args.allowlist)
        )

    if stale:
        print()
        print(
            "::error::%d allowlist entry/entries match nothing while their pull "
            "request is inside the window: %s" % (len(stale), "; ".join(stale))
        )

    if args.report_only:
        print()
        print("--report-only: exit 0")
        return 0
    if faults or stale:
        return 1
    print("every measurable line the audited pull requests added is still in the tree")
    return 0


if __name__ == "__main__":
    sys.exit(main())
