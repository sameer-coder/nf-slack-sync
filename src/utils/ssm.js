import AWS from 'aws-sdk'
import cfg from '../config.js'

export const loadConfigFromSSM = async ({
  loadAppConfig,
  loadSlack,
  loadGithub,
  loadSheet
}) => {
  const SSMClient = new AWS.SSM({ apiVersion: '2014-11-06' })

  const {
    SSM_SLACK_PARAMETER,
    SSM_CONFIG_PARAMETER,
    SSM_GITHUB_PARAMETER,
    SSM_SHEET_PARAMETER
  } = cfg

  const getParamFromSSMParam = []

  if (loadAppConfig) {
    getParamFromSSMParam.push(
      SSMClient.getParameter({
        Name: SSM_CONFIG_PARAMETER
      }).promise()
    )
  }

  if (loadSlack) {
    getParamFromSSMParam.push(
      SSMClient.getParameter({
        Name: SSM_SLACK_PARAMETER
      }).promise()
    )
  }

  if (loadGithub) {
    getParamFromSSMParam.push(
      SSMClient.getParameter({
        Name: SSM_GITHUB_PARAMETER
      }).promise()
    )
  }

  if (loadSheet) {
    getParamFromSSMParam.push(
      SSMClient.getParameter({
        Name: SSM_SHEET_PARAMETER
      }).promise()
    )
  }

  const results = await Promise.all(getParamFromSSMParam)

  const envFromSSM = results.reduce((acc, crr) => {
    const parsedResult = JSON.parse(crr.Parameter.Value)

    if (parsedResult.organizationSlug) {
      acc.githubConfig = parsedResult
      return acc
    }

    if (parsedResult.signingSecret) {
      acc.slackConfig = parsedResult
      return acc
    }

    if (parsedResult[0]?.githubTeam) {
      acc.appConfig = parsedResult
      return acc
    }

    acc.sheetConfig = parsedResult
    return acc
  }, {})

  // available for all the application
  global.appVariables = {
    ...envFromSSM
  }
}
