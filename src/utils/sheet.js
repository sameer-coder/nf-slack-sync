import { google } from 'googleapis'

import { getFromSheetConfig } from './global.js'

const SHEET_A1_NOTATION_REGEX =
  /^(?<sheet>(["'].+["']|[\p{L}\p{N}_]+))?!?(?<range>([a-zA-Z]\w*:[a-zA-Z]\w*)|(\d+:\d+))?$/u

/**
 * Authorizes the provided service account against Google's API and returns
 * a corresponding jwtClient
 *
 * @function authorize
 * @returns {Promise<object>}: Google Sheets client with authorized credentials
 */
export async function authorizeSheetsClient(serviceAccountKey) {
  const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

  try {
    const { client_email: clientEmail, private_key: privateKey } =
      serviceAccountKey

    const jwtClient = new google.auth.JWT(clientEmail, null, privateKey, SCOPES)
    await jwtClient.authorize()

    return google.sheets({ version: 'v4', auth: jwtClient })
  } catch (error) {
    if (
      error.name === 'TypeError' &&
      error.message.includes("Cannot destructure property 'client_email'")
    ) {
      return null
    }

    throw error
  }
}

/**
 * Iterates over the spreadsheet's data range backwards in order to find
 * the given name's last entry.
 *
 * @function findLastEntryForUserInSheet
 * @param client {object}: Google Sheets client
 * @param username {string}: User's GitHub username to match in the sheet
 * @param idx {number}: Sheet configuration index
 * @returns {Promise<object>}: An object containing the `lastEntry` data and
 *                             its index in the values range
 */
export async function findLastEntryForUserInSheet(client, username, idx) {
  if (!client) {
    return {}
  }

  if (typeof username !== 'string') {
    const error = new Error(
      `Expected username to be string. Got ${typeof username}.`
    )
    error.username = username

    throw error
  }

  const { data } = await client.spreadsheets.values.get({
    spreadsheetId: getFromSheetConfig('spreadsheetId', idx),
    range: getFromSheetConfig('dataRange', idx)
  })

  const lowerCaseUsername = username.toLowerCase()

  for (let idx = data.values.length - 1; idx >= 0; --idx) {
    // FIXME - this is currently tailored to the Bench Data spreadsheet's format.
    // Definitely not future-proof
    if (
      data.values[idx][5] && // assert github username is set in sheet
      data.values[idx][5].toLowerCase() === lowerCaseUsername
    ) {
      return {
        index: idx,
        lastEntry: data.values[idx]
      }
    }
  }

  return {}
}

/**
 * Iterates over the spreadsheet's data range backwards in order to find
 * the given name's last entry.
 *
 * @function findLastEntryByRealNameInSheet
 * @param client {object}: Google Sheets client
 * @param username {string}: User's Real Name as provided by Slack to find in the sheet
 * @param idx {number}: Sheet configuration index
 * @returns {Promise<object>}: An object containing the `lastEntry` data and
 *                             its index in the values range
 */
export async function findLastEntryByRealNameInSheet(client, realName, idx) {
  if (!client) {
    return {}
  }

  if (typeof realName !== 'string' || realName === '') {
    throw new Error('expected realName to be a non-empty string')
  }

  const { data } = await client.spreadsheets.values.get({
    spreadsheetId: getFromSheetConfig('spreadsheetId', idx),
    range: getFromSheetConfig('dataRange', idx)
  })

  for (let index = data.values.length - 1; index >= 0; index--) {
    const entry = data.values[index]
    const [entryRealName] = entry
    if (entryRealName && entryRealName === realName) {
      return { index, lastEntry: entry }
    }
  }

  return {}
}

/**
 * Returns a formatted date string based on the specified locale and timezone
 * constraints in the configuration
 *
 * @function formatDateForSheet
 * @param date {object}: A JavaScript Date object
 * @param idx {number}: Sheet configuration index
 * @returns {string}: The formatted date string
 */
export function formatDateForSheet(date, idx) {
  return date.toLocaleDateString(getFromSheetConfig('locale', idx), {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    timeZone: getFromSheetConfig('timezone', idx)
  })
}

/**
 * Returns a range string in A1 notation for the specified row number within
 * the set dataRange
 *
 * @function getEntryRowRange
 * @param index {number}: The entry index in dataRange
 * @param sheetConfigIndex {number}: Sheet configuration index
 * @returns {string}: Range string in A1 notation
 */
export function getEntryRowRange(index, sheetConfigIndex) {
  const dataRange = getFromSheetConfig('dataRange', sheetConfigIndex)
  const match = dataRange.match(SHEET_A1_NOTATION_REGEX)
  if (!match || !match.groups || !(match.groups.sheet || match.groups.range)) {
    throw new Error(`Invalid data range: ${dataRange}`)
  }

  const { groups } = match

  const firstRowMatch = groups.range?.match(/(\d+):/)
  const firstRow = firstRowMatch ? Number.parseInt(firstRowMatch[1], 10) : 1

  const sheet = groups.sheet ?? ''
  const range = groups.range?.replace(/\d*:.*/, index + firstRow) ?? ''
  const sep = sheet && range ? '!' : ''

  return `${sheet}${sep}${range}`
}

/**
 * Appends a new entry to the spreadsheet's data range specified in the
 * configuration
 *
 * @function appendEntryToSpreadsheet
 * @param client {object}: Google Sheets client
 * @param entry {Array<any>}: Entry formatted as an array. Each element
 *                            represents a cell in the row's entry
 * @param idx {number}: Sheet configuration index
 * @returns {Promise<void>}: undefined
 */
export async function appendEntryToSpreadsheet(client, entry, idx) {
  await client.spreadsheets.values.append({
    spreadsheetId: getFromSheetConfig('spreadsheetId', idx),
    range: getFromSheetConfig('dataRange', idx),
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      majorDimension: 'ROWS',
      values: [entry]
    }
  })
}

/**
 * Updates a pre-existing entry in the spreadsheet's data range specified
 *
 * @function updateEntryOnSpreadsheet
 * @param client {object}: Google Sheets client
 * @param entry {Array<any>}: Entry formatted as an array. Each element
 *                            represents a cell in the row's entry
 * @param range {string}: Range in A1 notation
 * @param idx {number}: Sheet configuration index
 * @returns {Promise<void>}: undefined
 */
export async function updateEntryOnSpreadsheet(client, entry, range, idx) {
  await client.spreadsheets.values.update({
    spreadsheetId: getFromSheetConfig('spreadsheetId', idx),
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      majorDimension: 'ROWS',
      values: [entry]
    }
  })
}
