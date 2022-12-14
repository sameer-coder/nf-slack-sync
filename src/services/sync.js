import {
  addMemberToOneTeam,
  getGithubUserFromURL,
  removeMemberFromOneTeam,
  ghListOrgTeamMembers,
  ghListAllOrgMembers
} from '../utils/github.js'
import {
  getAppConfig,
  getFromGithubConfig,
  findSheetConfigIndex
} from '../utils/global.js'
import {
  getUserProfile,
  getChannelMembers,
  getGithubProfileUrlFieldValue
} from '../utils/slack.js'
import {
  addMemberLeftEntryToSpreadsheet,
  addMemberJoinedEntryToSpreadsheet
} from './members.js'

// Exported only because we can't test it indirectly due to constrains on nock's API
export function getErrorMessage(err) {
  return err.name === 'HttpError'
    ? `HttpError(status: ${err.status}${
        err.response && err.response.data ? ', data: ' + err.response.data : ''
      })`
    : `${err.name}(${err.message})`
}

export async function sync({ slackClient, sheetsClients }, logger) {
  const organizationSlug = getFromGithubConfig('organizationSlug')
  const orgResp = await ghListAllOrgMembers(organizationSlug)
  const orgMembers = new Set(orgResp?.map(m => m.login?.toLowerCase()))
  const appConfig = getAppConfig()
  const { client } = slackClient

  for await (const config of appConfig) {
    const sheetIdx = findSheetConfigIndex('slackChannel', config.slackChannel)
    const sheetsClient = sheetsClients ? sheetsClients[sheetIdx] : null

    const [channelResp, teamResp] = await Promise.all([
      getChannelMembers(client, config.slackChannel),
      ghListOrgTeamMembers(organizationSlug, config.githubTeam)
    ])
    const slackMembers = channelResp.members
    const teamMembers = new Set(teamResp?.map(m => m.login?.toLowerCase()))

    // Compare slack and github members, add new ones from slack
    const addStep = await Promise.allSettled(
      slackMembers.map(async slackUser => {
        const userProfile = await getUserProfile(client, slackUser)
        if (userProfile.api_app_id) return

        const githubProfileUrl = getGithubProfileUrlFieldValue(userProfile)
        if (!githubProfileUrl) return

        const ghUser = getGithubUserFromURL(githubProfileUrl)
        if (!orgMembers.has(ghUser)) return

        // Check user is found on GitHub and remove from remaining users
        if (teamMembers.has(ghUser)) {
          teamMembers.delete(ghUser)
        } else {
          logger.info('New user found:', ghUser)

          const results = await Promise.allSettled([
            addMemberToOneTeam(ghUser, organizationSlug, config.githubTeam),
            addMemberJoinedEntryToSpreadsheet(
              { userProfile },
              sheetsClient,
              sheetIdx,
              logger
            )
          ])

          const error = results
            .filter(r => r.status === 'rejected')
            .map(r => getErrorMessage(r.reason))
            .reduce((acc, r) => `${acc}\n\t\t${r}`, '')

          if (error) {
            const message = `Unable to handle removing user ${ghUser}. Reason(s):${error}`
            logger.error(message)
            throw new Error(message)
          }

          logger.info(
            `User ${ghUser} added to team "${config.githubTeam}" @ "${organizationSlug}"`
          )
        }
      })
    )

    // Remove remaining github users
    const deleteStep = await Promise.allSettled(
      [...teamMembers].map(async ghUser => {
        const results = await Promise.allSettled([
          removeMemberFromOneTeam(ghUser, organizationSlug, config.githubTeam),
          addMemberLeftEntryToSpreadsheet(
            ghUser,
            sheetsClient,
            sheetIdx,
            logger
          )
        ])

        const error = results
          .filter(r => r.status === 'rejected')
          .map(r => getErrorMessage(r.reason))
          .reduce((acc, r) => `${acc}\n\t\t${r}`, '')

        if (error) {
          const message = `Unable to handle removing user ${ghUser}. Reason(s):${error}`
          logger.error(message)
          throw new Error(message)
        }

        logger.info(
          `User ${ghUser} removed from team "${config.githubTeam}" @ "${organizationSlug}"`
        )
      })
    )

    const addStepErrors = addStep.filter(s => s.status === 'rejected')
    const deleteStepErrors = deleteStep.filter(s => s.status === 'rejected')

    if (addStepErrors.length > 0 || deleteStepErrors.length > 0) {
      throw new Error(
        `Some errors occurred during sync:\n\t${addStepErrors
          .concat(deleteStepErrors)
          .map(e => e.reason)
          .join('\n\t')}\n`
      )
    }
  }
}
