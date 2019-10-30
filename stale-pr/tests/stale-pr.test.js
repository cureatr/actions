jest.mock('@actions/core');
jest.mock('@actions/github');

const core = require('@actions/core');
const { GitHub, context } = require('@actions/github');
const run = require('../src/stale-pr');

describe('Stale PR', () => {
    let dismissReview, compareCommits;

    beforeEach(() => {
        compareCommits = jest.fn();
        let merge = jest.fn().mockReturnValueOnce({});
        let iterator = jest.fn().mockReturnValueOnce(
            [
                Promise.resolve({
                    data: [
                        {
                            id: 333,
                            state: 'APPROVED'
                        }
                    ]
                })
            ]
        );
        dismissReview = jest.fn();

        context.eventName = 'pull_request';
        context.payload = {
            action: 'synchronize',
            before: '790fe8dfc858c01f1620ca3a548e87d83743c968',
            after: 'c0de998dbee3354e636211dbad25515fffc57a70',
            number: 42,
            repository: {
                name: 'myrepo',
                owner: {
                    login: "octocat"
                }
            },
            pull_request: {
                base: {
                    sha: "93a783ae53a771682a2641c4a1f42df78feff95e"
                }
            }
        }

        core.getInput = jest
            .fn()
            .mockReturnValueOnce('myToken')
            .mockReturnValueOnce(false);

        const github = {
            repos: {
                compareCommits
            },
            pulls: {
                listReviews: {
                    endpoint: {
                        merge
                    }
                },
                dismissReview
            },
            paginate: {
                iterator
            }
        };

        GitHub.mockImplementation(() => github);
    });

    test('Do not dismiss if diffs are identical', async () => {
        compareCommits
            .mockReturnValueOnce({ data: '+ same' })
            .mockReturnValueOnce({ data: '+ same' });

        await run();

        expect(dismissReview).not.toHaveBeenCalled();
    });

    test('Dismiss if diffs differ', async () => {
        compareCommits
            .mockReturnValueOnce({ data: '+ same' })
            .mockReturnValueOnce({ data: '- diff' });

        await run();

        expect(dismissReview).toHaveBeenCalledWith(
            expect.objectContaining({
                owner: 'octocat',
                repo: 'myrepo',
                pull_number: 42,
                review_id: 333
            })
        );
    });

    test('Do not dismiss if filtered diffs are identical', async () => {
        compareCommits
            .mockReturnValueOnce({ data:
`
diff --git a/cureatr/lib/saml.py b/cureatr/lib/saml.py
index b9c4b80ad4..e6c4b00bed 100644
--- a/cureatr/lib/saml.py
+++ b/cureatr/lib/saml.py
@@ -154,7 +154,7 @@ def get_saml_redirect_url(http_info):
     return the URL that we need to redirect to.
     """
     headers = http_info.get('headers', None)
-    if not headers:
+    if not headers or http_info.get('method') != 'GET':
         return None
 
     for key, val in headers:
`
            })
            .mockReturnValueOnce({ data:
`
diff --git a/cureatr/lib/saml.py b/cureatr/lib/saml.py
index 7d1a64cc9d..b07c4b6e99 100644
--- a/cureatr/lib/saml.py
+++ b/cureatr/lib/saml.py
@@ -157,7 +157,7 @@ def get_saml_redirect_url(http_info):
     return the URL that we need to redirect to.
     """
     headers = http_info.get('headers', None)
-    if not headers:
+    if not headers or http_info.get('method') != 'GET':
         return None
 
     for key, val in headers:
`
            });

        await run();

        expect(dismissReview).not.toHaveBeenCalled();
    });
});