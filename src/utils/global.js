export const getFromGithubConfig = param =>
  global.appVariables.githubConfig[param]

export const getFromSlackConfig = param =>
  global.appVariables.slackConfig[param]

export const getFromSheetConfig = (param, index) =>
  global.appVariables.sheetConfig && global.appVariables.sheetConfig[index]
    ? global.appVariables.sheetConfig[index][param]
    : null

export const findSheetConfigIndex = (param, value) =>
  global.appVariables.sheetConfig?.indexOf
    ? global.appVariables.sheetConfig.indexOf(
        global.appVariables.sheetConfig.find(sc => sc[param] === value)
      )
    : -1

export const getSheetConfig = () => global.appVariables.sheetConfig ?? []

export const getAppConfig = () => {
  return global.appVariables.appConfig
}
