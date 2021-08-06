const util = require('util');
const core = require('@actions/core')
const github = require('@actions/github')
const jsdiff = require('diff')

async function run() {
    try {
        const context = github.context;
        // This action only works on pull_request synchronized events
        if (context.eventName != 'pull_request') {
            console.warn('context:', context);
            core.setFailed('This action requires a pull_request synchronize event');
            return;
        }
        if (context.payload.action != 'synchronize') {
            console.log('Skipping for %s action', context.payload.action);
            return;
        }
        const token = core.getInput('github-token', { required: true });
        const debug = core.getInput('debug');
        const opts = {};
        if (debug === 'true') {
            opts.log = console;
        }
        const octokit = github.getOctokit(token, opts);
        const baseSha = context.payload.pull_request.base.sha;
        const beforeSha = context.payload.before;
        const afterSha = context.payload.after;
        const { data: rawBeforeDiff } = await octokit.rest.repos.compareCommitsWithBasehead({
            owner: context.payload.repository.owner.login,
            repo: context.payload.repository.name,
            basehead: `${baseSha}...${beforeSha}`,
            mediaType: {
                format: 'diff'
            }
        });
        const { data: rawAfterDiff } = await octokit.rest.repos.compareCommitsWithBasehead({
            owner: context.payload.repository.owner.login,
            repo: context.payload.repository.name,
            basehead: `${baseSha}...${afterSha}`,
            mediaType: {
                format: 'diff'
            }
        });

        // Strip any lines that don't begin with space or +/-.
        // We need to remove lines like "index b9c4b80ad4..e6c4b00bed 100644" because when squashing,
        // the commit that an identical change was introduced in can change.
        // We need to remove lines like "@@ -481,7 +481,7 @@" because an identical change may have moved
        // line position due to upstream changes it was rebased onto.
        const re = /^[^ +-].*$/gm;
        const beforeDiff = rawBeforeDiff.replace(re, "");
        const afterDiff = rawAfterDiff.replace(re, "");
        if (beforeDiff == afterDiff) {
            console.log('Diffs are identical, skipping review dismissal');
            return;
        }
        console.log('Diffs are different.\nbefore (%s..%s):\n%s\nafter (%s..%s):\n%s', baseSha, beforeSha, beforeDiff, baseSha, afterSha, afterDiff);
        const diffDiff = jsdiff.createTwoFilesPatch('before-patch', 'after-patch', beforeDiff, afterDiff, '', '', { context: 0 });

        // Dismiss any approved reviews of this PR if this push introduced changes
        for await (const chunk of octokit.paginate.iterator(octokit.rest.pulls.listReviews, {
            owner: context.payload.repository.owner.login,
            repo: context.payload.repository.name,
            pull_number: context.payload.number
        })) {
            for (const review of chunk.data) {
                if (review.state == 'APPROVED') {
                    const result = await octokit.rest.pulls.dismissReview({
                        owner: context.payload.repository.owner.login,
                        repo: context.payload.repository.name,
                        pull_number: context.payload.number,
                        review_id: review.id,
                        message: util.format('PR has new changes, this review is stale - dismissing.')
                    });
                    console.log('Dismissing review %d: %s', review.id, JSON.stringify(result));
                }
            }
        }
        const result = await octokit.rest.issues.createComment({
            owner: context.payload.repository.owner.login,
            repo: context.payload.repository.name,
            issue_number: context.payload.number,
            body: util.format('PR has new changes. Diff of diffs:\n```diff\n%s\n```', diffDiff)
        });
        console.log('Created comment: %s', JSON.stringify(result));
    } catch (error) {
        console.error(error);
        core.setFailed(error.message);
    }
}

module.exports = run;
