import { App, AwsLambdaReceiver } from '@slack/bolt'
import { sqsSendMessage } from '../services/sqs.js'
import LoggerInit from 'pino'
import { loadConfigFromSSM } from '../utils/ssm.js'
import { getFromSlackConfig } from '../utils/global.js'

const logger = LoggerInit()

const init = async () => {
  try {
    await loadConfigFromSSM({
      loadAppConfig: true,
      loadSlack: true,
      loadGithub: false,
      loadSheet: false
    })

    // The Lambda Handler Receiver
    const awsLambdaReceiver = new AwsLambdaReceiver({
      signingSecret: getFromSlackConfig('signingSecret')
    })

    // Start BOLT using awsLambdaReceiver
    const app = new App({
      token: getFromSlackConfig('botToken'),
      receiver: awsLambdaReceiver
    })

    // Listen to member_joined_channel event
    app.event('member_joined_channel', sqsSendMessage)

    // // Linsten to member_left_channel event
    app.event('member_left_channel', sqsSendMessage)

    // Linsten to user updated profile event
    app.event('user_change', sqsSendMessage)

    return {
      awsLambdaReceiver
    }
  } catch (error) {
    logger.error('Init application Error', error)
    throw new Error(error)
  }
}

const initPromise = init()

/**
 * Lambda Entry Point
 *
 * @function handler
 * @author Jhon Rocha
 * @param {any} event - Lambda Event from AWS Api Gateway
 * @param {any} context - Lambda Context
 * @param {any} callback - Lambda Callback
 * @returns {any} A Lambda Handler
 */
export const handler = async (event, context, callback) => {
  const funcConfig = await initPromise

  const awsHandler = await funcConfig.awsLambdaReceiver.start()
  return awsHandler(event, context, callback)
}
