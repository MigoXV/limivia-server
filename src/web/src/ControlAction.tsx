import { Action } from './Forms'
import { api, type DeviceState } from './device'

export function ControlAction({ state }: { state: DeviceState }) {
  return state.control.mine && state.control.held ? (
    <Action run={() => api.run('control.release')}>释放设备控制</Action>
  ) : (
    <Action
      disabled={!state.identity || (state.control.owner_online && !state.control.mine)}
      run={async () => {
        const takeover = state.control.held && !state.control.mine
        if (takeover && !confirm('原控制页面已离线。接管会重新确认控制权，不会停止现有输出。'))
          return
        await api.wait(await api.submit('control.acquire', {}, takeover))
      }}
    >
      {state.control.held ? '接管设备控制' : '取得设备控制'}
    </Action>
  )
}
