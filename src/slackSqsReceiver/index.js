/* eslint-disable no-constant-condition */
import LoggerInit from 'pino'
import { App } from '@slack/bolt'

import { getErrorMessage } from '../services/sync.js'
import { loadConfigFromSSM } from '../utils/ssm.js'
import { authorizeSheetsClient } from '../utils/sheet.js'
import { sendMessageToAMember } from '../utils/slack.js'
import {
  getSheetConfig,
  getFromSlackConfig,
  getFromGithubConfig,
  findSheetConfigIndex
} from '../utils/global.js'
import {
  reAddMemberToGithubTeams,
  addMemberToGithubTeam,
  removeMemberFromGithubTeam,
  addMemberLeftEntryToSpreadsheet,
  addMemberJoinedEntryToSpreadsheet,
  addAnonMemberJoinedEntryToSpreadsheet,
  updateMemberGithubProfileInSheets
} from '../services/members.js'

const logger = LoggerInit({ level: 'info' })

const init = async () => {
  logger.info('initialising receiver')
  try {
    await loadConfigFromSSM({
      loadAppConfig: true,
      loadSlack: true,
      loadGithub: true,
      loadSheet: true
    })

    const slackClient = new App({
      token: getFromSlackConfig('botToken'),
      signingSecret: getFromSlackConfig('signingSecret')
    })

    const sheetsClients = await Promise.all(
      getSheetConfig().map(sc => authorizeSheetsClient(sc.serviceAccountKey))
    )

    return { slackClient, sheetsClients }
  } catch (error) {
    logger.error('Init application error', error.message)

    if (error instanceof Error) {
      throw error
    }

    throw new Error(error)
  }
}

const initPromise = init()

const handleMemberJoinedChannel = (slackEvent, clients) => {
  logger.info(
    `handling member join channel #${slackEvent.channel} event for ${slackEvent.userProfile.real_name}`
  )
  const { sheetsClients, slackClient } = clients

  const actionsToAwait = []
  if (getFromGithubConfig('privateKey')) {
    actionsToAwait.push(addMemberToGithubTeam(slackEvent, slackClient, logger))
  }

  const idx = findSheetConfigIndex('slackChannel', slackEvent.channel) ?? -1
  if (idx >= 0) {
    const sheetsClient = sheetsClients[idx]
    actionsToAwait.push(
      addMemberJoinedEntryToSpreadsheet(
        slackEvent,
        sheetsClient,
        idx,
        logger
      ).catch(error => {
        if (
          error instanceof Error &&
          error.message === 'Missing Github profile'
        ) {
          addAnonMemberJoinedEntryToSpreadsheet(
            slackEvent,
            sheetsClient,
            idx,
            logger
          ).then(() => {
            // rethrow as errors are used to trigger actions further up the call stack
            throw error
          })
        } else {
          // rethrow as errors are used to trigger actions further up the call stack
          throw error
        }
      })
    )
  } else {
    logger.warn('no sheet config found, skipping spreadsheet integration')
  }

  return actionsToAwait
}

const handleMemberLeftChannel = (slackEvent, clients) => {
  const { sheetsClients, slackClient } = clients

  const actionsToAwait = []
  if (getFromGithubConfig('privateKey')) {
    actionsToAwait.push(
      removeMemberFromGithubTeam(slackEvent, slackClient, logger)
    )
  }

  const idx = findSheetConfigIndex('slackChannel', slackEvent.channel) ?? -1
  if (idx >= 0) {
    const sheetsClient = sheetsClients[idx]
    actionsToAwait.push(
      addMemberLeftEntryToSpreadsheet(slackEvent, sheetsClient, idx, logger)
    )
  }

  return actionsToAwait
}

const handleMemberUserChangeChannel = (slackEvent, clients) => {
  logger.info(
    `handling slack user profile change for ${slackEvent.userProfile.real_name}`
  )

  const actionsToAwait = []
  if (getFromGithubConfig('privateKey')) {
    actionsToAwait.push(
      reAddMemberToGithubTeams(slackEvent, clients.slackClient, logger)
    )
  }

  actionsToAwait.push(
    updateMemberGithubProfileInSheets(slackEvent, clients, logger)
  )

  return actionsToAwait
}

export const handler = async event => {
  let funcConfig
  let slackEvent

  try {
    funcConfig = await initPromise
    slackEvent = JSON.parse(event.Records[0].body)
    const { type: eventType } = slackEvent
    let promises = []

    switch (eventType) {
      case 'member_joined_channel':
        promises = handleMemberJoinedChannel(slackEvent, funcConfig)
        break
      case 'member_left_channel':
        promises = handleMemberLeftChannel(slackEvent, funcConfig)
        break
      case 'user_change':
        promises = handleMemberUserChangeChannel(slackEvent, funcConfig)
        break
      default:
        logger.info('Event not supported')
        return
    }

    const results = await Promise.allSettled(promises)

    let missingGithubProfile = false
    const error = results
      .filter(r => r.status === 'rejected')
      .map(r => {
        if (r.reason?.message === 'Missing Github profile') {
          missingGithubProfile = true
        }

        return getErrorMessage(r.reason)
      })
      .reduce((acc, r) => `${acc}\n\t\t${r}`, '')

    if (error) {
      const message = `Failed handling ${eventType}. Reason(s):${error}`
      logger.error(message)
    }

    if (missingGithubProfile && eventType === 'member_joined_channel') {
      const slackUserId = slackEvent.user?.id
        ? slackEvent.user.id
        : slackEvent.user

      await sendMessageToAMember(
        funcConfig.slackClient.client,
        slackUserId,
        'Hi! Please, remember to set your Github url in your profile.'
      )
    }
  } catch (error) {
    logger.error(error)
  }
}
