import tap, { test } from 'tap'
import {
  getChannelMembers,
  getGithubProfileUrlFieldValue,
  getUserProfile,
  sendMessageToAMember
} from '../../src/utils/slack.js'
import { getFromSlackConfig } from '../../src/utils/global.js'
import { initTestEnv } from '../setup-test.js'

tap.before(async () => {
  await initTestEnv()
})

test('getGithubProfileUrlFieldValue: should return okay for valid params', async t => {
  const user = 'user123'
  const profile = {
    fields: {
      [getFromSlackConfig('githubUrlField')]: {
        value: `https://github.com/${user}`
      }
    }
  }
  t.equal(getGithubProfileUrlFieldValue(profile), `https://github.com/${user}`)
})

test('getGithubProfileUrlFieldValue: should not return for missing value', async t => {
  const user = 'user123'
  t.notOk(getGithubProfileUrlFieldValue())
  const profile = {}
  t.notOk(getGithubProfileUrlFieldValue(profile))
  profile.fields = {}
  t.notOk(getGithubProfileUrlFieldValue(profile))
  profile.fields[getFromSlackConfig('githubUrlField')] = {}
  t.notOk(getGithubProfileUrlFieldValue(profile))
  profile.fields[
    getFromSlackConfig('githubUrlField')
  ].value = `https://github.com/${user}`
  t.equal(getGithubProfileUrlFieldValue(profile), `https://github.com/${user}`)
})

test('getUserProfile: should return okay for valid params', async t => {
  const userId = 'userId123'
  const client = {
    users: {
      profile: {
        get: async ({ user }) => {
          t.equal(user, userId)
          return { profile: { ok: 'Ok!' } }
        }
      }
    }
  }
  const profile = await getUserProfile(client, userId)
  t.same(profile, { ok: 'Ok!' })
})

test('getUserProfile: should throw when client fails', async t => {
  t.plan(2)
  const userId = 'userId123'
  const client = {
    users: {
      profile: {
        get: async ({ user }) => {
          t.equal(user, userId)
          throw new Error('Failed client request!')
        }
      }
    }
  }
  t.rejects(getUserProfile(client, userId))
})

test('sendMessageToAMember: should return okay for valid params', async t => {
  t.plan(3)
  const userId = 'userId123'
  const message = 'Testing value'
  const client = {
    chat: {
      postMessage: async ({ channel, text }) => {
        t.equal(channel, userId)
        t.equal(text, message)
        return true
      }
    }
  }
  t.ok(await sendMessageToAMember(client, userId, message))
})

test('sendMessageToAMember: should fail if slack client fails', async t => {
  t.plan(3)
  const userId = 'userId123'
  const message = 'Testing value'
  const client = {
    chat: {
      postMessage: async ({ channel, text }) => {
        t.equal(channel, userId)
        t.equal(text, message)
        throw new Error('Failed request!')
      }
    }
  }
  t.rejects(sendMessageToAMember(client, userId, message))
})

test('getChannelMembers: should return okay for valid params', async t => {
  t.plan(2)
  const channelId = 'userId123'
  const client = {
    conversations: {
      members: async ({ channel }) => {
        t.equal(channel, channelId)
        return true
      }
    }
  }
  t.ok(await getChannelMembers(client, channelId))
})

test('getChannelMembers: should fail if slack client fails', async t => {
  t.plan(2)
  const channelId = 'userId123'
  const client = {
    conversations: {
      members: async ({ channel }) => {
        t.equal(channel, channelId)
        throw new Error('Failed request!')
      }
    }
  }
  t.rejects(getChannelMembers(client, channelId))
})
