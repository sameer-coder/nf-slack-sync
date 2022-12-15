import { Octokit } from '@octokit/core'
import { paginateRest } from '@octokit/plugin-paginate-rest'
import { createAppAuth } from '@octokit/auth-app'
import { getFromGithubConfig } from './global.js'

/**
 * Adds an organization member to a Github team.
 *
 * If user does not exists in the organization, Github automatically will send an email to the user with an invitation
 * to the team. It user already exists in the organization, the user will be added to the team.
 *
 * For more information, here the link to the Github API endpoint:
 * https://docs.github.com/en/rest/reference/teams#add-or-update-team-membership-for-a-user
 *
 * This request returns 404 error if username does not exists
 *
 * @param username {string}
 * @param org {string}
 * @param teamSlug {string}
 * @returns {Promise<Response>}
 */
export async function addMemberToOneTeam(username, org, teamSlug) {
  const github = await githubHandler()
  return github.request(
    `PUT /orgs/${org}/teams/${teamSlug}/memberships/${username}`
  )
}

/**
 * Removes an organization member from a Github team.
 *
 * For more information, here the link to the Github API endpoint:
 * https://docs.github.com/en/rest/reference/teams#remove-team-membership-for-a-user
 *
 * @param username {string}
 * @param org {string}
 * @param teamSlug {string}
 * @returns {Promise<Response>}
 */
export async function removeMemberFromOneTeam(username, org, teamSlug) {
  const github = await githubHandler()
  return github.request(
    `DELETE /orgs/${org}/teams/${teamSlug}/memberships/${username}`
  )
}

/**
 * List GitHub team members on an organization
 * @function ghListOrgTeamMembers
 * @param {string} org - The org param
 * @param {string} teamSlug - The teamSlug param
 * @returns {Promise<Response>}
 */
export async function ghListOrgTeamMembers(org, teamSlug) {
  const github = await githubHandler()
  return github.paginate(`GET /orgs/${org}/teams/${teamSlug}/members`, {
    per_page: 100
  })
}

/**
 * List GitHub team members on an organization
 * @function ghListAllOrgMembers
 * @param {string} org - The org param
 * @returns {Promise<Array>}
 */
export async function ghListAllOrgMembers(org) {
  const github = await githubHandler()
  return github.paginate(`GET /orgs/${org}/members`, {
    per_page: 100
  })
}

/**
 * Get Github username from Github profile url.
 *
 *
 * @param profileUrl {string}
 * @returns {string}
 */
export function getGithubUserFromURL(url) {
  const githubIoUrl = '.github.io'
  return url.includes(githubIoUrl)
    ? url.split(githubIoUrl).shift().split('//').pop().toLowerCase()
    : url.split('/').pop().toLowerCase()
}

/**
 * Check if a user is member of an organization
 * @function ghCheckOrgMember
 * @param {string} org - organization
 * @param {string} username - username
 * @returns {Promise}
 */
export async function ghCheckOrgMember(org, username) {
  const github = await githubHandler()
  return github.paginate('GET /orgs/{org}/members/{username}', {
    org,
    username
  })
}

// Storing the github Octokit instance on global scope
// this is cached between lambda invocations
// it automatically handles expired credentials
// Ref: https://docs.aws.amazon.com/lambda/latest/operatorguide/static-initialization.html
let githubOctokit

/**
 * Uses github app to retrieve an authenticated token
 *
 * @function githubHandler
 * @param {boolean} cache=true - use cached Octokit
 * @returns {Promise<Octokit>} Token string
 */
export async function githubHandler(cache = true) {
  if (cache && githubOctokit) return githubOctokit
  const MyOctokit = Octokit.plugin(paginateRest)
  const appOctokit = new MyOctokit({
    authStrategy: createAppAuth,
    auth: {
      appId: getFromGithubConfig('appId'),
      privateKey: getFromGithubConfig('privateKey')
    }
  })
  // Get the installation id for the current organization
  let data
  try {
    console.log(`${JSON.stringify(appOctokit)}`)
    const response = await appOctokit.request('/app/installations')
    console.log(`------------response is ${response}`)
    data = response.data
  } catch (error) {
    console.log('---------error is', error.message)
  }
  const org = data.find(
    ins =>
      ins.account &&
      ins.account.login === getFromGithubConfig('organizationSlug')
  )
  if (!org) {
    throw new Error(
      `Installation not found for ${getFromGithubConfig('organizationSlug')}`
    )
  }
  // Create the instance of Octokit validated for the installation
  githubOctokit = await appOctokit.auth({
    type: 'installation',
    installationId: org.id,
    factory: auth =>
      new MyOctokit({
        authStrategy: createAppAuth,
        auth
      })
  })
  return githubOctokit
}
