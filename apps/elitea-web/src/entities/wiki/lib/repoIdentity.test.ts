/**
 * The 27 legacy repository-identity cases, run against the TypeScript port.
 *
 * WHERE THESE COME FROM. apps/deepwiki-ui/src/getConfiguredRepo.test.js is 823
 * lines that re-declare all 19 identity functions inline and test THOSE copies.
 * It therefore never had the power to catch drift in the shipped code — it
 * would have stayed green through any change to DeepWikiApp.jsx.
 *
 * The copies were compared against the shipped definitions before this port:
 * all 19 are identical modulo whitespace, which is what makes these cases a
 * valid oracle for behaviour rather than a description of a fork.
 *
 * THE CASE BODIES ARE THE ORIGINAL'S, transcribed mechanically and not
 * rewritten. They keep their `throw new Error` style rather than being
 * converted to expect(), because the point of this file is that the
 * expectations are the legacy suite's own and not a fresh reading of what the
 * code appears to do. Only the imports changed: these now call the TypeScript.
 *
 * Ported bug-for-bug is the standard here. A case that looks wrong is a
 * decision this port is required to preserve — see the asymmetric branch rule
 * in manifestMatchesRepo, and the ambiguity refusal in filterManifestsByRepo.
 */
import { describe, it } from 'vitest';

import { artifactMatchesRepo, filterManifestsByRepo, manifestMatchesRepo, normalizeRepoToWikiIdPrefix } from './repoMatch';
import { parseRepositoryIdentity } from './repoUrl';
import { getCodeToolkitReference, getConfiguredRepo, getConfiguredRepoIdentity } from './toolkitSettings';

describe('repository identity (legacy oracle)', () => {

  it('Returns resolvedRepoName when provided', () => {
    const result = getConfiguredRepo({}, {}, 'EliteaAI/elitea-sdk');
    if (result !== 'EliteaAI/elitea-sdk') {
    throw new Error(`Expected 'EliteaAI/elitea-sdk', got '${result}'`);
    }
  });

  it('Falls back to toolkit_configuration_github_repository when resolvedRepoName is null', () => {
    const settings = { toolkit_configuration_github_repository: 'org/repo-from-settings' };
    const result = getConfiguredRepo({}, settings, null);
    if (result !== 'org/repo-from-settings') {
    throw new Error(`Expected 'org/repo-from-settings', got '${result}'`);
    }
  });

  it('Falls back to github_repository field', () => {
    const settings = { github_repository: 'org/github-repo' };
    const result = getConfiguredRepo({}, settings, null);
    if (result !== 'org/github-repo') {
    throw new Error(`Expected 'org/github-repo', got '${result}'`);
    }
  });

  it('Falls back to repository field', () => {
    const settings = { repository: 'org/plain-repo' };
    const result = getConfiguredRepo({}, settings, null);
    if (result !== 'org/plain-repo') {
    throw new Error(`Expected 'org/plain-repo', got '${result}'`);
    }
  });

  it('Falls back to repo field', () => {
    const settings = { repo: 'org/short-repo' };
    const result = getConfiguredRepo({}, settings, null);
    if (result !== 'org/short-repo') {
    throw new Error(`Expected 'org/short-repo', got '${result}'`);
    }
  });

  it('Falls back to toolkit_config.github_repository', () => {
    const toolkit = { toolkit_config: { github_repository: 'org/config-repo' } };
    const result = getConfiguredRepo(toolkit, {}, null);
    if (result !== 'org/config-repo') {
    throw new Error(`Expected 'org/config-repo', got '${result}'`);
    }
  });

  it('Falls back to toolkit_config.repository', () => {
    const toolkit = { toolkit_config: { repository: 'org/config-plain-repo' } };
    const result = getConfiguredRepo(toolkit, {}, null);
    if (result !== 'org/config-plain-repo') {
    throw new Error(`Expected 'org/config-plain-repo', got '${result}'`);
    }
  });

  it('Returns null when no repository is configured', () => {
    const result = getConfiguredRepo({}, {}, null);
    if (result !== null) {
    throw new Error(`Expected null, got '${result}'`);
    }
  });

  it('resolvedRepoName takes priority over direct settings', () => {
    const settings = { repository: 'should-not-be-used' };
    const result = getConfiguredRepo({}, settings, 'resolved/repo');
    if (result !== 'resolved/repo') {
    throw new Error(`Expected 'resolved/repo', got '${result}'`);
    }
  });

  it('Handles undefined toolkit gracefully', () => {
    const result = getConfiguredRepo(undefined, undefined, 'org/fallback');
    if (result !== 'org/fallback') {
    throw new Error(`Expected 'org/fallback', got '${result}'`);
    }
  });

  it('BUG 2854: Correctly uses resolvedRepoName when settings only has toolkit_configuration_code_repository (integer ID)', () => {
    // This is the actual data structure that caused the bug
    const settings = {
    toolkit_configuration_code_repository: 123, // Integer ID, not repository name
    toolkit_configuration_bucket: 'my-wiki-bucket',
    toolkit_configuration_llm_model: 'gpt-4',
    toolkit_configuration_max_tokens: 2048
    };

    // Without the fix, this would return null (bug behavior)
    const resultWithoutFix = getConfiguredRepo({}, settings, null);
    if (resultWithoutFix !== null) {
    throw new Error(`Without resolvedRepoName, should be null, got '${resultWithoutFix}'`);
    }

    // With the fix, when we resolve the toolkit reference and pass the repo name
    const resultWithFix = getConfiguredRepo({}, settings, 'EliteaAI/elitea-sdk');
    if (resultWithFix !== 'EliteaAI/elitea-sdk') {
    throw new Error(`With resolvedRepoName, expected 'EliteaAI/elitea-sdk', got '${resultWithFix}'`);
    }
  });

  it('Resolves legacy toolkit_configuration_code_repository reference field', () => {
    const settings = {
    toolkit_configuration_code_repository: 321,
    toolkit_configuration_bucket: 'wiki-artifacts'
    };

    const result = getCodeToolkitReference(settings);
    if (result !== 321) {
    throw new Error(`Expected legacy code repository reference 321, got '${result}'`);
    }
  });

  it('Resolves legacy code_repository reference field', () => {
    const settings = {
    code_repository: '654',
    bucket: 'wiki-artifacts'
    };

    const result = getCodeToolkitReference(settings);
    if (result !== '654') {
    throw new Error(`Expected legacy code repository reference '654', got '${result}'`);
    }
  });

  it('Builds ADO repository identifier from org/project/repository settings', () => {
    const settings = {
    ado_configuration: {
    organization_url: 'https://dev.azure.com/epameliteatest/',
    project: 'TestProject'
    },
    repository_id: 'mb-java'
    };

    const result = getConfiguredRepo({}, settings, null);
    if (result !== 'epameliteatest/TestProject/mb-java') {
    throw new Error(`Expected 'epameliteatest/TestProject/mb-java', got '${result}'`);
    }
  });

  it('Builds ADO repository identifier from transformed toolkit_configuration fields', () => {
    const settings = {
    toolkit_configuration_ado_configuration: {
    organization_url: 'https://dev.azure.com/epameliteatest/',
    project: 'TestProject'
    },
    toolkit_configuration_repository_id: 'mb-java'
    };

    const result = getConfiguredRepo({}, settings, null);
    if (result !== 'epameliteatest/TestProject/mb-java') {
    throw new Error(`Expected 'epameliteatest/TestProject/mb-java', got '${result}'`);
    }
  });

  it('Builds branch-aware ADO configured repo identity', () => {
    const settings = {
    toolkit_configuration_ado_configuration: {
    organization_url: 'https://dev.azure.com/epameliteatest/',
    project: 'TestProject'
    },
    toolkit_configuration_repository_id: 'TestProject',
    toolkit_configuration_base_branch: 'mb-java'
    };

    const identity = getConfiguredRepoIdentity({}, settings, null);
    // Guard added during the port. The original JS dereferenced this
    // directly; a null would have thrown a TypeError one line later, which
    // says nothing about which expectation failed.
    if (!identity) throw new Error('Expected an identity, got null');
    if (identity.repository !== 'epameliteatest/TestProject/TestProject') {
    throw new Error(`Expected repository 'epameliteatest/TestProject/TestProject', got '${identity.repository}'`);
    }
    if (identity.branch !== 'mb-java') {
    throw new Error(`Expected branch 'mb-java', got '${identity.branch}'`);
    }

    const prefix = normalizeRepoToWikiIdPrefix(identity);
    if (prefix !== 'epameliteatest--testproject--testproject--mb-java') {
    throw new Error(`Expected wiki_id prefix 'epameliteatest--testproject--testproject--mb-java', got '${prefix}'`);
    }
  });

  it('Builds ADO identity when repository and provider config are split across settings and toolkit_config', () => {
    const toolkit = {
    toolkit_config: {
    ado_configuration: {
    organization_url: 'https://dev.azure.com/epameliteatest/',
    project: 'TestProject',
    },
    },
    };
    const settings = {
    repository_id: 'TestProject',
    active_branch: 'mb-java',
    ado_configuration: {
    elitea_title: 'Ado_test',
    private: true,
    },
    };

    const identity = getConfiguredRepoIdentity(toolkit, settings, null);
    if (!identity) throw new Error('Expected an identity, got null');
    if (identity.repository !== 'epameliteatest/TestProject/TestProject') {
    throw new Error(`Expected merged ADO repository identity, got '${identity.repository}'`);
    }
    if (normalizeRepoToWikiIdPrefix(identity) !== 'epameliteatest--testproject--testproject--mb-java') {
    throw new Error(`Expected full ADO wiki prefix, got '${normalizeRepoToWikiIdPrefix(identity)}'`);
    }
  });

  it('Matches ADO manifest by wiki_id/repository/branch', () => {
    const manifest = {
    wiki_id: 'epameliteatest--testproject--testproject--mb-java',
    canonical_repo_identifier: 'epameliteatest/TestProject/TestProject:mb-java:6f785643',
    repository: 'epameliteatest/TestProject/TestProject',
    branch: 'mb-java'
    };
    const identity = {
    repository: 'epameliteatest/TestProject/TestProject',
    branch: 'mb-java'
    };

    if (!manifestMatchesRepo(manifest, identity)) {
    throw new Error('Expected manifest to match ADO configured repo identity');
    }
  });

  it('Matches ADO manifest by repository and branch when wiki_id is missing', () => {
    const manifest = {
    repository: 'epameliteatest/TestProject/TestProject',
    branch: 'mb-java'
    };
    const identity = {
    repository: 'epameliteatest/TestProject/TestProject',
    branch: 'mb-java'
    };

    if (!manifestMatchesRepo(manifest, identity)) {
    throw new Error('Expected manifest repository/branch to match ADO configured repo identity');
    }
  });

  it('Does not match unrelated ADO manifest versions from shared bucket', () => {
    const manifest = {
    wiki_id: 'eliteaai--alita-sdk--main',
    canonical_repo_identifier: 'EliteaAI/alita-sdk:main:923d6d27',
    repository: 'EliteaAI/alita-sdk',
    branch: 'main'
    };
    const identity = {
    repository: 'epameliteatest/TestProject/TestProject',
    branch: 'mb-java'
    };

    if (manifestMatchesRepo(manifest, identity)) {
    throw new Error('Expected unrelated manifest to be filtered out');
    }
  });

  it('Normalizes canonical repo identifier with branch and commit to wiki_id prefix', () => {
    const prefix = normalizeRepoToWikiIdPrefix('epameliteatest/TestProject/TestProject:mb-java:6f785643');
    if (prefix !== 'epameliteatest--testproject--testproject--mb-java') {
    throw new Error(`Expected canonical prefix, got '${prefix}'`);
    }
  });

  it('Keeps single-segment ADO repo storage key without suffix-matching full manifests', () => {
    const identity = getConfiguredRepoIdentity(
    {},
    {
    repository_id: 'TestProject',
    active_branch: 'mb-java',
    ado_configuration: {
    elitea_title: 'TestRepo',
    private: true,
    },
    },
    null
    );
    const manifest = {
    wiki_id: 'epameliteatest--testproject--testproject--mb-java',
    canonical_repo_identifier: 'epameliteatest/TestProject/TestProject:mb-java:6f785643',
    repository: 'epameliteatest/TestProject/TestProject',
    branch: 'mb-java',
    };

    const prefix = normalizeRepoToWikiIdPrefix(identity);
    if (prefix !== 'testproject--mb-java') {
    throw new Error(`Expected single-segment ADO storage prefix 'testproject--mb-java', got '${prefix}'`);
    }
    if (manifestMatchesRepo(manifest, identity)) {
    throw new Error('Expected leaf-only ADO identity not to match a full canonical manifest by suffix');
    }
  });

  it('Resolves a leaf-only ADO manifest only when the canonical match is unambiguous', () => {
    const identity = {
    repository: 'TestProject',
    branch: 'mb-java',
    };
    const manifests = [
    {
    wiki_id: 'epameliteatest--testproject--testproject--mb-java',
    canonical_repo_identifier: 'epameliteatest/TestProject/TestProject:mb-java:6f785643',
    repository: 'epameliteatest/TestProject/TestProject',
    branch: 'mb-java',
    },
    ];

    const matches = filterManifestsByRepo(manifests, identity);
    if (matches.length !== 1 || matches[0] !== manifests[0]) {
    throw new Error(`Expected exactly one unambiguous leaf match, got ${matches.length}`);
    }
  });

  it('Rejects ambiguous leaf-only ADO manifest matches from shared buckets', () => {
    const identity = {
    repository: 'service',
    branch: 'main',
    };
    const manifests = [
    {
    wiki_id: 'orga--proj1--service--main',
    canonical_repo_identifier: 'orgA/proj1/service:main:11111111',
    repository: 'orgA/proj1/service',
    branch: 'main',
    },
    {
    wiki_id: 'orgb--proj2--service--main',
    canonical_repo_identifier: 'orgB/proj2/service:main:22222222',
    repository: 'orgB/proj2/service',
    branch: 'main',
    },
    ];

    const matches = filterManifestsByRepo(manifests, identity);
    if (matches.length !== 0) {
    throw new Error(`Expected ambiguous leaf matches to be rejected, got ${matches.length}`);
    }
  });

  it('Does not suffix-match ADO artifact folders when full prefix is unavailable', () => {
    const identity = {
    repository: 'TestProject',
    branch: 'mb-java',
    };
    const artifactName = 'epameliteatest--testproject--testproject--mb-java/wiki_pages/overview.md';

    if (artifactMatchesRepo(artifactName, identity)) {
    throw new Error('Expected full artifact path not to match a leaf-only repo by suffix');
    }
    if (!artifactMatchesRepo('testproject--mb-java/wiki_pages/overview.md', identity)) {
    throw new Error('Expected exact leaf-only artifact prefix to match');
    }
    if (artifactMatchesRepo('eliteaai--alita-sdk--main/wiki_pages/overview.md', identity)) {
    throw new Error('Expected unrelated artifact path to be filtered out');
    }
  });

  it('Does not leaf-match ADO manifest from another branch', () => {
    const identity = {
    repository: 'TestProject',
    branch: 'mb-java',
    };
    const manifest = {
    wiki_id: 'epameliteatest--testproject--testproject--main',
    canonical_repo_identifier: 'epameliteatest/TestProject/TestProject:main:6f785643',
    repository: 'epameliteatest/TestProject/TestProject',
    branch: 'main',
    };

    if (manifestMatchesRepo(manifest, identity)) {
    throw new Error('Expected manifest from another branch to be filtered out');
    }
  });

  it('Preserves organization when parsing legacy visualstudio.com ADO repository URLs', () => {
    const identity = parseRepositoryIdentity('https://epameliteatest.visualstudio.com/TestProject/_git/TestRepo');

    if (identity.repository !== 'epameliteatest/TestProject/TestRepo') {
    throw new Error(`Expected visualstudio repo path with org, got '${identity.repository}'`);
    }
  });

});
