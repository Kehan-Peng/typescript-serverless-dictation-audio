import { CLOUD_ENV_ID } from './config/index'

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('当前微信基础库不支持云开发')
      return
    }
    wx.cloud.init({
      env: CLOUD_ENV_ID || undefined,
      traceUser: true,
    })
  },
})
