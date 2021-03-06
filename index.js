const { getConfig } = require('./lib/config')
const { isTriggerableReference } = require('./lib/triggerable-reference')
const {
  findReleases,
  generateReleaseInfo,
  createRelease,
  updateRelease,
} = require('./lib/releases')
const { findCommitsWithAssociatedPullRequests } = require('./lib/commits')
const { sortPullRequests } = require('./lib/sort-pull-requests')
const log = require('./lib/log')
const core = require('@actions/core')

module.exports = (app) => {
  app.on('push', async (context) => {
    const { shouldDraft, configName, version, tag, name } = getInput()

    const config = await getConfig({
      app,
      context,
      configName,
    })

    const { isPreRelease } = getInput({ config })

    if (config === null) return

    // GitHub Actions merge payloads slightly differ, in that their ref points
    // to the PR branch instead of refs/heads/master
    // context.payload.ref
    const ref = context.payload.ref
    const masterRef = 'refs/heads/master'

    if (!isTriggerableReference({ ref:masterRef, app, context, config })) {
      return
    }

    const { draftRelease, lastRelease, lastPreRelease } = await findReleases({ app, context })
    let basisRelease = lastRelease;
    if(ref !== masterRef) {
      basisRelease = lastPreRelease;
    }
    const {
      commits,
      pullRequests: mergedPullRequests,
    } = await findCommitsWithAssociatedPullRequests({
      app,
      context,
      ref: masterRef,
      lastRelease: basisRelease,
      config,
    })

    const sortedMergedPullRequests = sortPullRequests(
      mergedPullRequests,
      config['sort-by'],
      config['sort-direction']
    )

    const releaseInfo = generateReleaseInfo({
      commits,
      config,
      lastRelease: basisRelease,
      mergedPullRequests: sortedMergedPullRequests,
      version,
      tag,
      name,
      isPreRelease,
      shouldDraft,
    })

    let createOrUpdateReleaseResponse
    if (!draftRelease) {
      log({ app, context, message: 'Creating new release' })
      createOrUpdateReleaseResponse = await createRelease({
        context,
        releaseInfo,
        config,
      })
    } else {
      log({ app, context, message: 'Updating existing release' })
      createOrUpdateReleaseResponse = await updateRelease({
        context,
        draftRelease,
        releaseInfo,
        config,
      })
    }

    setActionOutput(createOrUpdateReleaseResponse, releaseInfo)
  })
}

function getInput({ config } = {}) {
  // Returns all the inputs that doesn't need a merge with the config file
  if (!config) {
    return {
      shouldDraft: core.getInput('publish').toLowerCase() !== 'true',
      configName: core.getInput('config-name'),
      version: core.getInput('version') || undefined,
      tag: core.getInput('tag') || undefined,
      name: core.getInput('name') || undefined,
    }
  }

  // Merges the config file with the input
  // the input takes precedence, because it's more easy to change at runtime
  const preRelease = core.getInput('prerelease').toLowerCase()
  return {
    isPreRelease: preRelease === 'true' || (!preRelease && config.prerelease),
  }
}

function setActionOutput(releaseResponse, { body }) {
  const {
    data: {
      id: releaseId,
      html_url: htmlUrl,
      upload_url: uploadUrl,
      tag_name: tagName,
      name: name,
    },
  } = releaseResponse
  if (releaseId && Number.isInteger(releaseId))
    core.setOutput('id', releaseId.toString())
  if (htmlUrl) core.setOutput('html_url', htmlUrl)
  if (uploadUrl) core.setOutput('upload_url', uploadUrl)
  if (tagName) core.setOutput('tag_name', tagName)
  if (name) core.setOutput('name', name)
  core.setOutput('body', body)
}
