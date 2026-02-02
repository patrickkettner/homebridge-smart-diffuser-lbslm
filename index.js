const DiffuserPlatform = require('./src/platform');

module.exports = (api) => {
  api.registerPlatform('SmartDiffuserLBSLM', DiffuserPlatform);
};
