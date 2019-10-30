const util = require('util');
const core = require('@actions/core')
const {GitHub, context} = require('@actions/github')
const jsdiff = require('diff')

async function run() {
    try {
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
        const github = new GitHub(token, opts);
        const baseSha = context.payload.pull_request.base.sha;
        const beforeSha = context.payload.before;
        const afterSha = context.payload.after;
        const { data: rawBeforeDiff } = await github.repos.compareCommits({
            owner: context.payload.repository.owner.login,
            repo: context.payload.repository.name,
            base: baseSha,
            head: beforeSha,
            mediaType: {
                format: 'diff'
            }
        });
        const { data: rawAfterDiff } = await github.repos.compareCommits({
            owner: context.payload.repository.owner.login,
            repo: context.payload.repository.name,
            base: baseSha,
            head: afterSha,
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
        const options = github.pulls.listReviews.endpoint.merge({
            owner: context.payload.repository.owner.login,
            repo: context.payload.repository.name,
            pull_number: context.payload.number
        });
        for await (const chunk of github.paginate.iterator(options)) {
            for (const review of chunk.data) {
                if (review.state == 'APPROVED') {
                    console.log('Dismissing review %d', review.id);
                    await github.pulls.dismissReview({
                        owner: context.payload.repository.owner.login,
                        repo: context.payload.repository.name,
                        pull_number: context.payload.number,
                        review_id: review.id,
                        message: util.format('PR has new changes, this review is stale. Diff of diffs:\n```diff\n%s\n```', diffDiff)
                    });
                }
            }
        }
    } catch (error) {
        console.error(error);
        core.setFailed(error.message);
    }
}

module.exports = run;
