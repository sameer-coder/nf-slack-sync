import {
  findSheetConfigIndex,
  getAppConfig,
  getFromGithubConfig
} from '../utils/global.js'
import {
  getChannelMembers,
  getGithubProfileUrlFieldValue
} from '../utils/slack.js'
import {
  ghCheckOrgMember,
  addMemberToOneTeam,
  getGithubUserFromURL,
  removeMemberFromOneTeam
} from '../utils/github.js'
import {
  getEntryRowRange,
  formatDateForSheet,
  appendEntryToSpreadsheet,
  updateEntryOnSpreadsheet,
  findLastEntryForUserInSheet,
  findLastEntryByRealNameInSheet
} from '../utils/sheet.js'

/**
 * Get the github team from appConfig
 *
 * @function getGithubUser
 * @param slackEvent {object}: Slack event from SQS queue
 * @returns {string} The github user
 */
export function getGithubTeam(slackEvent) {
  const { channel } = slackEvent
  const appConfig = getAppConfig()
  const resp = appConfig.find(entry => entry.slackChannel === channel)
  return resp && resp.githubTeam
}

/**
 * Get the github user from a slack user id
 *
 * @function getGithubUser
 * @param slackEvent {object}: Slack event object
 * @returns {string} The github user
 */
export function getGithubUser(slackEvent) {
  const githubProfileUrl = getGithubProfileUrlFieldValue(slackEvent.userProfile)
  // Notify the user when github url is missing
  if (!githubProfileUrl) {
    throw new Error('Missing Github profile')
  }
  return getGithubUserFromURL(githubProfileUrl)
}

/**
 * Add member to github
 * It is executed everytime a new member is added to the channel
 * Gets the user added profile and tries to parse the github user from it
 * Then adds it to the github team on the organization
 *
 * @function addMemberEvent
 * @param slackEvent {object}: Slack event from SQS queue
 * @param appSlack {object}: Slack WebClient object
 * @param logger {object}: Logger Object
 * @returns {Promise} Api response
 */
export async function addMemberToGithubTeam(slackEvent, appSlack, logger) {
  logger.debug(
    `trying to add Slack user ${slackEvent.userProfile.real_name} to github team`
  )
  const githubUsername = getGithubUser(slackEvent)
  const githubTeam = getGithubTeam(slackEvent)

  if (githubTeam === undefined) {
    logger.error('Unable to retrieve Github team reference')
    throw new Error('Unable to retrieve Github team reference')
  }

  const organizationSlug = getFromGithubConfig('organizationSlug')

  try {
    await ghCheckOrgMember(organizationSlug, githubUsername)
  } catch (err) {
    logger.error(err.message)
    throw new Error(
      `User ${githubUsername} is not part of ${organizationSlug} organization`
    )
  }
  await addMemberToOneTeam(githubUsername, organizationSlug, githubTeam)
  logger.info(`User ${githubUsername} was added to Github team!`)
}

/**
 * Remove member from github
 * It is executed everytime a member is removed from the channel
 * Gets the user removed profile and tries to parse the github user from it
 * Then removes it from the github team on the organization
 *
 * @function removeMemberFromGithubTeam
 * @param slackEvent {object}: Slack event from SQS queue
 * @param appSlack {object}: Slack WebClient object
 * @param logger {object}: Logger Object
 * @returns {Promise} Api response
 */
export async function removeMemberFromGithubTeam(slackEvent, appSlack, logger) {
  const githubUsername = getGithubUser(slackEvent)
  const githubTeam = getGithubTeam(slackEvent)

  if (githubTeam === undefined) {
    logger.error('Unable to retrieve Github team reference')
    throw new Error('Unable to retrieve Github team reference')
  }

  await removeMemberFromOneTeam(
    githubUsername,
    getFromGithubConfig('organizationSlug'),
    githubTeam
  )
  logger.info(`User ${githubUsername} was removed from Github team!`)
}

/**
 * Listen to user profile changes and add it
 * to github team if on slack channel
 * @function userChange
 * @param slackEvent {object}: Slack event from SQS queue
 * @param appSlack {object}: Slack WebClient object
 * @param logger {object}: Logger Object
 * @returns {Promise} Api response
 */
export async function reAddMemberToGithubTeams(slackEvent, appSlack, logger) {
  logger.debug('checking to see if user needs to be a added to github team')
  try {
    const { id, profile } = slackEvent.user
    const githubProfileUrl = getGithubProfileUrlFieldValue(profile)

    if (!githubProfileUrl) {
      throw new Error('Missing Github profile')
    }

    const appConfig = getAppConfig()
    const githubUsername = getGithubUserFromURL(githubProfileUrl)
    const organizationSlug = getFromGithubConfig('organizationSlug')

    const addMemberToOneTeamPromises = appConfig.map(async entry => {
      const members = await getChannelMembers(
        appSlack.client,
        entry.slackChannel
      )
      if (members.members.find(m => m === id)) {
        await addMemberToOneTeam(
          githubUsername,
          organizationSlug,
          entry.githubTeam
        )
        logger.info(`User ${githubUsername} was (re)added to Github team!`)
      }
    })
    await Promise.all(addMemberToOneTeamPromises)
  } catch (err) {
    logger.error(err.message)
  }
}

/**
 * Handle slack event where a slack user's GitHub username has been set, but their entry in the spreadsheet has not yet been set. Updates the latest entry for the user with their GitHub username
 * @function handleChangedGithubProfile
 * @param slackEvent {object}: Slack event from SQS queue
 * @param clients {object}: an object containing the slackClient and sheetsClients
 * @param logger {object}: Logger Object
 * @returns {Promise<void>}: undefined
 */
export async function updateMemberGithubProfileInSheets(
  slackEvent,
  clients,
  logger
) {
  const { sheetsClients, slackClient } = clients
  if (sheetsClients.length === 0) {
    logger.info('no sheet config found, skipping spreadsheet integration')
    return
  }

  // throws if no github user exists, exiting handler early
  const username = getGithubUser(slackEvent)
  const realName =
    slackEvent.userProfile.real_name_normalized ??
    slackEvent.userProfile.real_name

  await Promise.all(
    getAppConfig().map(async entry => {
      const sheetIdx = findSheetConfigIndex('slackChannel', entry.slackChannel)
      const sheetsClient = sheetsClients[sheetIdx]
      const { members } = await getChannelMembers(
        slackClient.client,
        entry.slackChannel
      )
      if (members.some(m => m === slackEvent.user.id)) {
        const { index, lastEntry } = await findLastEntryByRealNameInSheet(
          sheetsClient,
          realName,
          sheetIdx
        )
        if (!lastEntry || (lastEntry.length >= 5 && lastEntry[5] !== '')) {
          logger.info(
            `user is either not in the sheet for channel #${entry.slackChannel}, or user already has github profile set, so there is nothing to change`
          )
          return
        }

        logger.info(
          `user exists in sheet for channel #${entry.slackChannel} and has a github profile to update - attempting to modify entry in spreadsheet`
        )

        // sheets truncates rows where cells contain empty values
        // doing this to make sure deliberately missing cells aren't lost/mangled
        const updatedEntry = [
          lastEntry[0],
          lastEntry[1],
          lastEntry[2],
          lastEntry[3] ?? '',
          lastEntry[4] ?? '',
          username
        ]
        const entryRange = getEntryRowRange(index, sheetIdx)
        await updateEntryOnSpreadsheet(
          sheetsClient,
          updatedEntry,
          entryRange,
          sheetIdx
        )
        logger.info(
          `update sheet entry for user ${realName}, setting GitHub username to ${username}`
        )
      }
    })
  )
}

/**
 * Handles adding a new entry to the spreadsheet for users that joined
 * the slack channel. Does nothing if the `sheetsClient` is not set up
 *
 * @function addMemberJoinedEntryToSpreadsheet
 * @param slackEvent {object}: Slack event from SQS queue
 * @param clients {object}: Object with the Google Sheets and Slack clients
 * @param idx {number}: Sheet configuration index
 * @param logger {object}: Logger object
 * @returns {Promise<void>}: undefined
 */
export async function addMemberJoinedEntryToSpreadsheet(
  slackEvent,
  sheetsClient,
  idx,
  logger
) {
  logger.info(
    `trying to add user ${slackEvent.userProfile.real_name} to spreadsheet`
  )
  if (!sheetsClient || idx === -1) {
    logger.warn('no sheets client is available, skipping')
    return
  }

  const username = getGithubUser(slackEvent)
  const { lastEntry } = await findLastEntryForUserInSheet(
    sheetsClient,
    username,
    idx
  )
  logger.debug(`lastEntry ${JSON.stringify(lastEntry)}`)

  const name =
    slackEvent.userProfile.real_name_normalized ??
    slackEvent.userProfile.real_name
  const today = formatDateForSheet(new Date(), idx)
  logger.debug(`today: ${today}`)

  if (lastEntry && today === lastEntry[2]) {
    logger.info(`${username} has already been added to the sheet today`)
    return
  }

  // FIXME - this is currently tailored to the Bench Data spreadsheet's format.
  // Definitely not future-proof
  const newEntry = [
    lastEntry ? lastEntry[0] : name,
    lastEntry ? lastEntry[1] : '',
    today,
    '',
    '',
    username
  ]

  await appendEntryToSpreadsheet(sheetsClient, newEntry, idx)
  logger.info(`Added new join spreadsheet entry for ${name} (${username}) (new \
hire? ${lastEntry ? 'No' : 'Yes'})`)
}

/**
 * Adds a new entry to the spreadsheet for a user with no GitHub username in their slack profile
 * @function addAnonMemberJoinedEntryToSpreadsheet
 * @param slackEvent {object}: Slack event from SQS queue
 * @param sheetsClient {object}: Client instance for interacting with Sheets API
 * @param idx {number}: Sheet configuration index
 * @param logger {object}: Logger instance
 * @returns {Promise<void>}: undefined
 */
export async function addAnonMemberJoinedEntryToSpreadsheet(
  slackEvent,
  sheetsClient,
  idx,
  logger
) {
  logger.info(
    `trying to add user ${slackEvent.userProfile.real_name} to spreadsheet without github username`
  )
  if (!sheetsClient || idx === -1) {
    logger.warn('no sheets client is available, skipping')
    return
  }

  const name =
    slackEvent.userProfile.real_name_normalized ??
    slackEvent.userProfile.real_name
  const today = formatDateForSheet(new Date(), idx)

  const newEntry = [name, '', today, '', '', '']

  await appendEntryToSpreadsheet(sheetsClient, newEntry, idx)
  logger.info(
    `Added new join spreadsheet entry for ${name} (no github profile set currently) (new hire? Yes})`
  )
}

/**
 * Handles adding a new entry to the spreadsheet for users that left
 * the slack channel. Does nothing if either the `userData` or `sheetsClient`
 * parameters are not set
 *
 * @function addMemberLeftEntryToSpreadsheet
 * @param userData {object|string}: Slack event or user's github username
 * @param sheetsClient {object}: Google Sheets JWT client object
 * @param idx {number}: Sheet configuration index
 * @param logger {object}: Logger object
 * @returns {Promise<void>}: undefined
 */
export async function addMemberLeftEntryToSpreadsheet(
  userData,
  sheetsClient,
  idx,
  logger
) {
  if (!userData || !sheetsClient || idx === -1) {
    return
  }

  let ghUser = userData
  if (typeof userData === 'object') {
    ghUser = getGithubUser(userData)
  }

  const { index, lastEntry } = await findLastEntryForUserInSheet(
    sheetsClient,
    ghUser,
    idx
  )

  if (!lastEntry) {
    throw new Error(
      `Couldn't find previous entry for ${ghUser} in the spreadsheet`
    )
  }

  if (lastEntry[3]) {
    throw new Error(
      `${ghUser}'s last entry in the spreadsheet already has an end date`
    )
  }

  const entryRange = getEntryRowRange(index, idx)
  const today = formatDateForSheet(new Date(), idx)

  // FIXME - this is currently tailored to the Bench Data spreadsheet's format.
  // Definitely not future-proof
  lastEntry[3] = today

  await updateEntryOnSpreadsheet(sheetsClient, lastEntry, entryRange, idx)
  logger.info(`Set end date on last spreadsheet entry for ${ghUser}`)
}
