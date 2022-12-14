import tap from 'tap'
import { sqsSendMessage } from '../../src/services/sqs.js'
import AWS from 'aws-sdk-mock'
import { getAppConfig } from '../../src/utils/global.js'
import { initTestEnv } from '../setup-test.js'

tap.before(async () => {
  await initTestEnv()
})

tap.test('sqsSendMessage should fail for wrong channel', async t => {
  const event = { channel: 'WRONG_CHANNEL' }
  const logger = {
    error: (_e, err) => {
      t.equal(
        err.message,
        '"WRONG_CHANNEL" is not a valid slack channel. Available channels are: "EX4MPL3CH4NN3L"'
      )
    },
    info: () => {}
  }
  const resp = await sqsSendMessage({ event, logger })
  t.same(resp, {
    message:
      '"WRONG_CHANNEL" is not a valid slack channel. Available channels are: "EX4MPL3CH4NN3L"'
  })
})

tap.test('sqsSendMessage should fail when user is a bot', async t => {
  const userId = 'userId123'
  const event = { channel: getAppConfig()[0].slackChannel, user: userId }

  const logger = {
    error: (_e, err) => {
      t.equal(err.message, 'User is a Slack App')
    },
    info: () => {}
  }
  const client = {
    users: {
      profile: {
        get: ({ user }) => {
          t.equal(user, userId)
          return { profile: { api_app_id: 'app123' } }
        }
      }
    },
    chat: {
      postMessage: () => t.fail()
    }
  }
  const resp = await sqsSendMessage({ event, client, logger })
  t.same(resp, { message: 'User is a Slack App' })
})

tap.test('sqs.sendmessage should be called with slack event', async t => {
  const userId = 'userId123'
  const event = {
    channel: getAppConfig()[0].slackChannel,
    user: userId,
    type: 'member_joined_channel'
  }

  AWS.mock('SQS', 'sendMessage', 'test')
  const logger = {
    error: () => {},
    info: () => {}
  }
  const client = {
    users: {
      profile: {
        get: ({ user }) => {
          t.equal(user, userId)
          return { profile: {} }
        }
      }
    },
    chat: {
      postMessage: () => t.fail()
    }
  }
  await sqsSendMessage({ event, client, logger })
  AWS.restore('SQS')
})

tap.test(
  'sqs.sendmessage should return SQS error message when something goes wrong with AWS',
  async t => {
    const userId = 'userId123'
    const event = {
      channel: getAppConfig()[0].slackChannel,
      user: userId,
      type: 'member_joined_channel'
    }

    AWS.mock('SQS', 'sendMessage', () => {
      throw new Error('SQS error')
    })
    const logger = {
      error: () => {},
      info: () => {}
    }
    const client = {
      users: {
        profile: {
          get: ({ user }) => {
            t.equal(user, userId)
            return { profile: {} }
          }
        }
      },
      chat: {
        postMessage: () => t.fail()
      }
    }
    const resp = await sqsSendMessage({ event, client, logger })
    t.same(resp, { message: 'SQS error' })
    AWS.restore('SQS')
  }
)
