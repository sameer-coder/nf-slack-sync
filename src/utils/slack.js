import { getFromSlackConfig } from './global.js'

/**
 * It returns the value of the Github user profile url field form Slack user details.
 *
 * @param profile {object}: Slack user profile
 * @returns {null|string}: Github url
 */
export function getGithubProfileUrlFieldValue(profile) {
  return profile?.fields?.[getFromSlackConfig('githubUrlField')]?.value
}

/**
 * It gets the user profile from the user that triggered the Slack event.
 *
 * @param client {object}: Slack WebClient object
 * @param userId {string}: Slack user id
 * @returns {Promise<object>}
 */
export async function getUserProfile(client, userId) {
  const result = await client.users.profile.get({ user: userId })

  return result.profile
}

/**
 * Send a message to a Slack MEme
 * @param client {object}: Slack WebClient object
 * @param userId {string}: Slack user id
 * @param text {string}: Slack message to send
 * @returns {Promise}
 */
export function sendMessageToAMember(client, userId, text) {
  return client.chat.postMessage({ channel: userId, text })
}

/**
 * Get members from a slack channel
 * @function getChannelMembers
 * @param client {object}: Slack WebClient object
 * @param channel {string}: Slack channel id
 * @returns {Promise}
 */
export async function getChannelMembers(client, channel) {
  return client.conversations.members({ channel })
}
