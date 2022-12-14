import AWS from 'aws-sdk'
import cfg from '../config.js'
import { getAppConfig } from '../utils/global.js'

/**
 * Get the slack profile
 *
 * @async
 * @function getUserProfile
 * @param client {object}: Slack WebClient object
 * @param userId {string}: Slack user id
 * @returns {Promise<object>} The slack profile
 */
export async function getUserProfile(client, userId) {
  const result = await client.users.profile.get({ user: userId })

  return result.profile
}

/**
 * creates the channels array
 *
 * @function getChannelsFromAppConfig
 * @returns {string[]} The slack profile
 */
export function getChannelsFromAppConfig() {
  const appConfig = getAppConfig()
  return appConfig.map(entry => entry.slackChannel)
}

/**
 * Get the event from slack and send to some SQS queue
 *
 * @async
 * @function sqsSendMessage
 * @param event {object}: Slack Event
 * @param client {object}: Slack WebClient object
 * @param logger {object}: logger from bolt
 * @returns {Promise} The sqs sendMessage result
 */
export const sqsSendMessage = async ({ event, client, logger }) => {
  try {
    const slackChannels = getChannelsFromAppConfig()
    if (event.channel && !slackChannels.includes(event.channel)) {
      throw new Error(
        `"${event.channel}" is not a valid slack channel. Available channels are: "${slackChannels}"`
      )
    }

    const sqs = new AWS.SQS({ apiVersion: '2012-11-05' })

    const {
      user: { profile }
    } = event

    const userProfile = profile || (await getUserProfile(client, event.user))

    if (userProfile.api_app_id) {
      throw new Error('User is a Slack App')
    }

    const slackEventWithUserProfile = {
      ...event,
      userProfile
    }

    const params = {
      DelaySeconds: 30,
      MessageAttributes: {
        EVENT_TYPE: {
          DataType: 'String',
          StringValue: event.type
        }
      },
      MessageBody: JSON.stringify(slackEventWithUserProfile),
      QueueUrl: cfg.SQS_QUEUE_URL
    }

    await sqs.sendMessage(params).promise()
  } catch (err) {
    logger.error('error', err)
    return { message: err.message }
  }
}
