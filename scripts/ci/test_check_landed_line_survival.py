#!/usr/bin/env python3
"""Assertions on check_landed_line_survival.py.

Issue #541. The defect the checker exists for is not hypothetical. Pull request
#502 landed a logout correction. Pull request #516 merged four hours later from
a branch that was cut before #502, and its squash wrote the five files back to
their pre-#502 copies. The check that was run was
`git merge-base --is-ancestor`, and it answered "true", because #502 was still
in the history. The content was gone.

Every scenario below builds a throwaway BARE repository with git plumbing
(`hash-object`, `update-index`, `write-tree`, `commit-tree`). No scenario
touches the repository that holds this file, and none of them needs a work
tree.

Scenario 1 is the regression test. It reproduces that exact shape and asserts
BOTH halves: `--is-ancestor` still answers "true" on it, and the checker still
answers "lost".

Run it with:  python3 -m unittest discover -s scripts/ci -p 'test_*.py'
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
# The path is overridable so a proof run can point the same assertions at an
# earlier copy of the checker and observe the red run.
CHECKER = os.environ.get(
    "LANDED_LINE_SURVIVAL_CHECKER",
    os.path.join(HERE, "check_landed_line_survival.py"),
)

GIT_ENV = {
    "GIT_AUTHOR_NAME": "Fixture",
    "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
    "GIT_COMMITTER_NAME": "Fixture",
    "GIT_COMMITTER_EMAIL": "fixture@example.invalid",
    "GIT_AUTHOR_DATE": "2026-08-17T21:53:00+0000",
    "GIT_COMMITTER_DATE": "2026-08-17T21:53:00+0000",
}

# The text #502 put into logout.ts, shortened. Every line is long enough and
# carries enough letters and digits to be measurable.
BEFORE_502 = """export async function logout(): Promise<void> {
  window.localStorage.removeItem('el.auth.state');
  await fetch('/api/v2/auth/logout', { method: 'POST' });
  window.location.assign('/login');
}
"""

AFTER_502 = """let loggingOut = false;

export function isLoggingOut(): boolean {
  return loggingOut;
}

export async function logout(): Promise<void> {
  loggingOut = true;
  window.localStorage.removeItem('el.auth.flight.started');
  await fetch('/api/v2/auth/logout', { method: 'POST' });
  window.location.assign('/login');
}
"""

UNRELATED = """export const budgetCeiling = 1000;
export const budgetWindowDays = 30;
export function overBudget(spend: number): boolean {
  return spend > budgetCeiling;
}
"""


def run(args, cwd=None):
    env = dict(os.environ)
    env.update(GIT_ENV)
    return subprocess.run(
        args,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


class Fixture:
    """A bare repository built one commit at a time."""

    def __init__(self, root: str) -> None:
        self.path = os.path.join(root, "repo.git")
        self.root = root
        check = run(["git", "init", "--quiet", "--bare", self.path])
        assert check.returncode == 0, check.stdout
        run(["git", "-C", self.path, "symbolic-ref", "HEAD", "refs/heads/main"])
        self._head = None
        self._counter = 0

    def _git(self, *args, index=None):
        env = dict(os.environ)
        env.update(GIT_ENV)
        if index:
            env["GIT_INDEX_FILE"] = index
        proc = subprocess.run(
            ["git", "-C", self.path, *args],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        assert proc.returncode == 0, "git %s: %s" % (" ".join(args), proc.stderr)
        return proc.stdout

    def commit(self, files, subject: str) -> str:
        """Write one commit whose tree is exactly `files` (path -> text)."""
        self._counter += 1
        index = os.path.join(self.root, "index-%d" % self._counter)
        for path, text in sorted(files.items()):
            proc = subprocess.run(
                ["git", "-C", self.path, "hash-object", "-w", "--stdin"],
                input=text,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            assert proc.returncode == 0, proc.stderr
            oid = proc.stdout.strip()
            self._git(
                "update-index",
                "--add",
                "--cacheinfo",
                "100644,%s,%s" % (oid, path),
                index=index,
            )
        tree = self._git("write-tree", index=index).strip()
        args = ["commit-tree", tree, "-m", subject]
        if self._head:
            args += ["-p", self._head]
        sha = self._git(*args).strip()
        self._git("update-ref", "refs/heads/main", sha)
        self._head = sha
        return sha

    def branch(self, name: str, sha: str) -> None:
        self._git("update-ref", "refs/heads/%s" % name, sha)

    def check(self, *extra):
        return run(
            [sys.executable, CHECKER, "--repo", self.path, *extra],
        )


class LandedLineSurvivalTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="line-survival-")
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.repo = Fixture(self.root)

    # -- scenario 1: the regression test ---------------------------------

    def test_a_stale_squash_that_restores_the_old_file_is_a_fault(self):
        """The #502 shape. Ancestry says yes, and the content is gone."""
        base = self.repo.commit(
            {"src/logout.ts": BEFORE_502, "README.md": "elitea\n"},
            "chore: base (#400)",
        )
        landed = self.repo.commit(
            {"src/logout.ts": AFTER_502, "README.md": "elitea\n"},
            "fix(web): the logout must not start a flight (#502)",
        )
        # The stale squash writes the whole file back to its pre-#502 copy.
        stale = self.repo.commit(
            {
                "src/logout.ts": BEFORE_502,
                "README.md": "elitea\n",
                "src/budget.ts": UNRELATED,
            },
            "feat(budgets): add usage dimensions (#516)",
        )
        self.repo.commit(
            {
                "src/logout.ts": BEFORE_502,
                "README.md": "elitea\n",
                "src/budget.ts": UNRELATED,
                "docs/notes.md": "a later unrelated pull request\n",
            },
            "fix(gateway): clear an outage-owned row (#530)",
        )
        self.assertNotEqual(base, landed)

        # The check that was run in the issue. It passes, and it is not
        # evidence: the blob it reports on is gone.
        ancestry = run(
            ["git", "-C", self.repo.path, "merge-base", "--is-ancestor", landed, "HEAD"]
        )
        self.assertEqual(
            ancestry.returncode,
            0,
            "the fixture must reproduce the false negative: --is-ancestor has to "
            "answer 'true' for the pull request whose work was deleted",
        )

        result = self.repo.check("--limit", "10")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("RESTORED", result.stdout)
        self.assertIn("src/logout.ts", result.stdout)
        # It must name BOTH pull requests, and the second one is the point.
        self.assertIn("added by   PR #502", result.stdout)
        self.assertIn("deleted by PR #516", result.stdout)
        self.assertIn("isLoggingOut", result.stdout)

    # -- scenario 2: the text comes back without a byte-exact blob -------

    def test_a_revert_that_no_exact_blob_records_is_still_a_fault(self):
        """The stale branch also edited the file, so no blob matches.

        The exact-blob test then answers "no" at every commit, and the old text
        is back all the same. Ask for the text.
        """
        self.repo.commit({"src/logout.ts": BEFORE_502}, "chore: base (#400)")
        self.repo.commit(
            {"src/logout.ts": AFTER_502},
            "fix(web): the logout must not start a flight (#502)",
        )
        stale_copy = BEFORE_502 + "\nexport const authModuleVersion = 'v2.1.0';\n"
        self.repo.commit(
            {"src/logout.ts": stale_copy},
            "feat(budgets): add usage dimensions (#516)",
        )
        self.repo.commit(
            {"src/logout.ts": stale_copy, "docs/notes.md": "a later change\n"},
            "chore: an unrelated pull request (#540)",
        )
        result = self.repo.check("--limit", "10")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("REVERTED", result.stdout)
        self.assertIn("added by   PR #502", result.stdout)
        self.assertIn("deleted by PR #516", result.stdout)

    # -- scenario 3: an ordinary rewrite is not a fault ------------------

    def test_an_ordinary_rewrite_is_reported_and_is_not_a_fault(self):
        self.repo.commit({"src/logout.ts": BEFORE_502}, "chore: base (#400)")
        self.repo.commit(
            {"src/logout.ts": AFTER_502},
            "fix(web): the logout must not start a flight (#502)",
        )
        # Every line #502 added is gone, and the text it removed did NOT come
        # back. This is a rewrite, and a gate that failed on it would fail on
        # most pull requests.
        rewritten = """export async function logout(): Promise<void> {
  await signOutThroughTheProvider({ returnTo: '/login' });
}
"""
        self.repo.commit(
            {"src/logout.ts": rewritten},
            "refactor(web): move the logout into the provider (#560)",
        )
        result = self.repo.check("--limit", "10")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("rewritten (reported, not a fault)", result.stdout)
        self.assertNotIn("LOST WORK", result.stdout)

    def test_history_that_kept_its_work_is_silent(self):
        self.repo.commit({"src/logout.ts": BEFORE_502}, "chore: base (#400)")
        self.repo.commit(
            {"src/logout.ts": AFTER_502},
            "fix(web): the logout must not start a flight (#502)",
        )
        self.repo.commit(
            {"src/logout.ts": AFTER_502, "src/budget.ts": UNRELATED},
            "feat(budgets): add usage dimensions (#516)",
        )
        result = self.repo.check("--limit", "10")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("still in the tree", result.stdout)

    # -- scenario 4: it cannot fail the pull request that runs it --------

    def test_the_tree_under_review_stays_out_of_the_measurement(self):
        """The property that keeps this gate off the pull request that adds it.

        A pull request may legitimately rewrite lines an earlier pull request
        added. The workflow passes the BASE branch head as the tip, so the
        proposed tree is never read.
        """
        self.repo.commit({"src/logout.ts": BEFORE_502}, "chore: base (#400)")
        self.repo.commit(
            {"src/logout.ts": AFTER_502},
            "fix(web): the logout must not start a flight (#502)",
        )
        base_head = self.repo.commit(
            {"src/logout.ts": AFTER_502, "src/budget.ts": UNRELATED},
            "feat(budgets): add usage dimensions (#516)",
        )
        # The pull request under review rewrites the file wholesale, the way a
        # large branch does.
        proposed = self.repo.commit(
            {"src/logout.ts": BEFORE_502, "src/budget.ts": UNRELATED},
            "feat: a large branch that rewrites the auth module (#541)",
        )
        self.repo.branch("pr", proposed)

        with_base_tip = self.repo.check("--limit", "10", "--tip", base_head)
        self.assertEqual(with_base_tip.returncode, 0, with_base_tip.stdout)
        self.assertIn("still in the tree", with_base_tip.stdout)

        # Reading the proposed tree instead WOULD be red. The tip is the whole
        # difference, so the workflow must keep passing the base.
        with_proposed_tip = self.repo.check("--limit", "10", "--tip", proposed)
        self.assertEqual(with_proposed_tip.returncode, 1, with_proposed_tip.stdout)

    # -- scenario 5: a window that measures nothing is red ---------------

    def test_an_empty_window_is_red_rather_than_green(self):
        self.repo.commit({"src/logout.ts": BEFORE_502}, "chore: base (#400)")
        self.repo.commit({"src/logout.ts": AFTER_502}, "fix(web): a fix (#502)")
        result = self.repo.check("--limit", "0")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("measured nothing", result.stdout)

    def test_subjects_without_a_pull_request_number_are_red(self):
        self.repo.commit({"src/logout.ts": BEFORE_502}, "chore: base")
        self.repo.commit({"src/logout.ts": AFTER_502}, "fix the logout")
        result = self.repo.check("--limit", "10")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("no audited commit names a pull request", result.stdout)

    def test_a_shallow_clone_is_red_rather_than_a_short_walk(self):
        head = self.repo.commit({"src/logout.ts": BEFORE_502}, "chore: base (#400)")
        self.repo.commit({"src/logout.ts": AFTER_502}, "fix(web): a fix (#502)")
        # A shallow clone is exactly this file plus a grafted boundary. The
        # walk would then read whatever the clone happens to hold.
        with open(os.path.join(self.repo.path, "shallow"), "w") as handle:
            handle.write("%s\n" % head)
        result = self.repo.check("--limit", "10")
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("clone is shallow", result.stdout)

    # -- scenario 6: the allowlist, and its own rot ----------------------

    def _stale_squash_history(self):
        self.repo.commit({"src/logout.ts": BEFORE_502}, "chore: base (#400)")
        self.repo.commit(
            {"src/logout.ts": AFTER_502},
            "fix(web): the logout must not start a flight (#502)",
        )
        self.repo.commit(
            {"src/logout.ts": BEFORE_502},
            "feat(budgets): add usage dimensions (#516)",
        )

    def test_an_allowlist_entry_accepts_a_named_removal(self):
        self._stale_squash_history()
        allow = os.path.join(self.root, "allow.txt")
        with open(allow, "w") as handle:
            handle.write("502 src/logout.ts  # accepted: the flight moved\n")
        result = self.repo.check("--limit", "10", "--allowlist", allow)
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_an_allowlist_entry_that_matches_nothing_is_red(self):
        self._stale_squash_history()
        allow = os.path.join(self.root, "allow.txt")
        with open(allow, "w") as handle:
            handle.write("502 src/logout.ts  # accepted\n")
            handle.write("516 src/nowhere.ts  # nothing here any more\n")
        result = self.repo.check("--limit", "10", "--allowlist", allow)
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn("match nothing", result.stdout)

    def test_an_allowlist_entry_outside_the_window_is_ignored(self):
        self._stale_squash_history()
        allow = os.path.join(self.root, "allow.txt")
        with open(allow, "w") as handle:
            handle.write("502 src/logout.ts  # accepted\n")
            handle.write("11 src/ancient.ts  # merged long before the window\n")
        result = self.repo.check("--limit", "10", "--allowlist", allow)
        self.assertEqual(result.returncode, 0, result.stdout)

    # -- scenario 7: a file the tip does not hold is not measured --------

    def test_a_deleted_path_is_not_reported_as_lost_work(self):
        self.repo.commit({"src/logout.ts": BEFORE_502}, "chore: base (#400)")
        self.repo.commit(
            {"src/logout.ts": AFTER_502, "src/legacy.ts": UNRELATED},
            "fix(web): the logout must not start a flight (#502)",
        )
        # A deliberate deletion. The checker states it cannot tell one from a
        # rename, so it must stay quiet about the path.
        self.repo.commit(
            {"src/logout.ts": AFTER_502},
            "chore(web): drop the legacy module (#560)",
        )
        result = self.repo.check("--limit", "10")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertNotIn("src/legacy.ts", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
