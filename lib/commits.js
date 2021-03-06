const log = require('./log')
const paginate = require('./pagination')
const _ = require('lodash')

module.exports.findCommitsWithAssociatedPullRequestsQuery = /* GraphQL */ `
  query findCommitsWithAssociatedPullRequests(
    $name: String!
    $owner: String!
    $ref: String!
    $withPullRequestBody: Boolean!
    $withPullRequestURL: Boolean!
    $since: GitTimestamp
    $after: String
  ) {
    repository(name: $name, owner: $owner) {
      ref(qualifiedName: $ref) {
        target {
          ... on Commit {
            history(first: 100, since: $since, after: $after) {
              totalCount
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                committedDate
                message
                author {
                  name
                  user {
                    login
                  }
                }
                associatedPullRequests(first: 5) {
                  nodes {
                    title
                    number
                    url @include(if: $withPullRequestURL)
                    body @include(if: $withPullRequestBody)
                    author {
                      login
                    }
                    baseRepository {
                      nameWithOwner
                    }
                    mergedAt
                    isCrossRepository
                    labels(first: 10) {
                      nodes {
                        name
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`

module.exports.findCommitsWithAssociatedPullRequests = async ({
  app,
  context,
  ref,
  lastRelease,
  config,
}) => {
  const { owner, repo } = context.repo()
  const withPullRequestBody = config['change-template'].includes('$BODY') || config['change-template'].includes('$NOTE');
  const variables = {
    name: repo,
    owner,
    ref,
    withPullRequestBody: withPullRequestBody,
    withPullRequestURL: config['change-template'].includes('$URL'),
  }
  const dataPath = ['repository', 'ref', 'target', 'history']
  const repoNameWithOwner = `${owner}/${repo}`

  let data, commits
  if (lastRelease) {
    log({
      app,
      context,
      message: `Fetching all commits for reference ${ref} since ${lastRelease.created_at}`,
    })

    data = await paginate(
      context.github.graphql,
      module.exports.findCommitsWithAssociatedPullRequestsQuery,
      { ...variables, since: lastRelease.created_at },
      dataPath
    )
    // GraphQL call is inclusive of commits from the specified dates.  This means the final
    // commit from the last tag is included, so we remove this here.
    commits = _.get(data, [...dataPath, 'nodes']).filter(
      (commit) => commit.committedDate != lastRelease.created_at
    )
  } else {
    log({ app, context, message: `Fetching all commits for reference ${ref}` })

    data = await paginate(
      context.github.graphql,
      module.exports.findCommitsWithAssociatedPullRequestsQuery,
      variables,
      dataPath
    )
    commits = _.get(data, [...dataPath, 'nodes'])
  }

  const pullRequests = _.uniqBy(
    _.flatten(commits.map((commit) => commit.associatedPullRequests.nodes)),
    'number'
  ).filter((pr) => pr.baseRepository.nameWithOwner === repoNameWithOwner)

  return { commits, pullRequests }
}
