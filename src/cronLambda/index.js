import bolt from '@slack/bolt'
import { sync } from '../services/sync.js'
import LoggerInit from 'pino'
import { loadConfigFromSSM } from '../utils/ssm.js'
import { authorizeSheetsClient } from '../utils/sheet.js'
import { getSheetConfig, getFromSlackConfig } from '../utils/global.js'

const { App } = bolt

const logger = LoggerInit()

const init = async () => {
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
    logger.error('Init Lambda Error', error)
    throw new Error(error)
  }
}

const initPromise = init()

export async function handler() {
  const funcConfig = await initPromise
  return await sync(funcConfig, logger)
}
