import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DeviceClient,
  DeviceCommandError,
  discoverDevices,
  friendlyError,
  type DeviceOption,
  type Hello,
  type LinkKind,
  type Sample,
  type Snapshot,
} from './device'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'ready' | 'lost'
export interface Feedback {
  scope: string
  kind: 'success' | 'error' | 'unknown'
  text: string
}
export interface CommandLog {
  id: number
  time: string
  direction: string
  text: string
}

export function useWorkbench() {
  const [client] = useState(() => new DeviceClient())
  const [link, setLink] = useState<LinkKind>('ble')
  const [devices, setDevices] = useState<DeviceOption[]>([])
  const [target, setTarget] = useState('')
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [hello, setHello] = useState<Hello | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [stale, setStale] = useState(false)
  const [pending, setPending] = useState<{ op: string; scope: string } | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const [sampleEpoch, setSampleEpoch] = useState(0)
  const [logs, setLogs] = useState<CommandLog[]>([])
  const lock = useRef(false)
  const generation = useRef(0)
  const logId = useRef(0)
  const ready = status === 'ready'
  const enabled = ready && !stale && !pending
  const log = useCallback((direction: string, text: string) => {
    setLogs((previous) => [
      ...previous.slice(-199),
      {
        id: ++logId.current,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        direction,
        text,
      },
    ])
  }, [])
  const addSample = useCallback((sample: Sample) => {
    setSamples((previous) => [...previous.slice(-119), sample])
  }, [])

  useEffect(() => {
    const lifecycle = generation
    client.setHandlers({
      onLog: log,
      onClose: (reason) => {
        ++generation.current
        setStatus('lost')
        setStale(true)
        setConnectionError(reason ?? '设备连接已断开，请重新连接。')
        log('连接', '连接已丢失；板上任务可能仍在运行。')
      },
      onEvent: (message) => {
        if (message.event === 'adc' && message.data) addSample(message.data)
      },
    })
    return () => {
      ++lifecycle.current
      client.setHandlers({})
      void client.disconnect()
    }
  }, [client, log, addSample])

  useEffect(() => {
    if (!ready || stale || pending) return
    let disposed = false
    const timer = setInterval(() => {
      if (lock.current || client.busy) return
      const epoch = generation.current
      void client
        .request<Snapshot>('state')
        .then((value) => {
          if (!disposed && epoch === generation.current) setSnapshot(value)
        })
        .catch((err) => {
          if (!disposed && epoch === generation.current) {
            setStale(true)
            setFeedback({ scope: 'all', kind: 'unknown', text: friendlyError(err) })
          }
        })
    }, 1500)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [client, ready, stale, pending])

  function changeLink(value: LinkKind) {
    if (ready || searching || status === 'connecting') return
    setLink(value)
    setDevices([])
    setTarget('')
    setSearched(false)
    setConnectionError('')
  }
  async function search() {
    if (lock.current || ready) return
    lock.current = true
    setSearching(true)
    setConnectionError('')
    setDevices([])
    setTarget('')
    setSearched(false)
    try {
      const found = await discoverDevices(link)
      setDevices(found)
      setSearched(true)
      if (found.length === 1) setTarget(found[0].id)
    } catch (err) {
      setConnectionError(friendlyError(err))
    } finally {
      lock.current = false
      setSearching(false)
    }
  }
  async function connect() {
    if (lock.current || ready || !target) return false
    lock.current = true
    ++generation.current
    setConnectionError('')
    setFeedback(null)
    setStatus('connecting')
    setStale(true)
    try {
      const result = await client.connect(link, target)
      setHello(result)
      setSnapshot(result.state)
      setSamples([])
      setSampleEpoch((value) => value + 1)
      setStatus('ready')
      setStale(false)
      log(
        '连接',
        `${link.toUpperCase()} · ${result.device_id} · 固件 ${result.firmware} · 状态已同步`,
      )
      return true
    } catch (err) {
      setStatus('disconnected')
      setConnectionError(friendlyError(err))
      log('失败', friendlyError(err))
      return false
    } finally {
      lock.current = false
    }
  }
  async function disconnect() {
    if (lock.current) return false
    ++generation.current
    setStatus('disconnected')
    setStale(true)
    setFeedback(null)
    await client.disconnect()
    log('连接', '主动断开连接；设备本地任务会继续运行。')
    return true
  }
  async function act(op: string, params: Record<string, unknown> = {}, scope = 'all') {
    if (lock.current || !ready || (stale && op !== 'state')) return false
    lock.current = true
    const epoch = ++generation.current
    setPending({ op, scope })
    setFeedback(null)
    try {
      const result = await client.request<Snapshot | Sample>(op, params)
      if (epoch !== generation.current) return false
      if ('raw' in result) addSample(result)
      const next = 'pins' in result ? result : await client.request<Snapshot>('state')
      if (epoch !== generation.current) return false
      setSnapshot(next)
      setStale(false)
      setFeedback({
        scope,
        kind: 'success',
        text: op === 'state' ? '设备状态已读取。' : '设备已确认，状态已同步。',
      })
      log('完成', op === 'state' ? '设备状态已读取' : op)
      return true
    } catch (err) {
      if (epoch === generation.current) {
        const rejected = err instanceof DeviceCommandError && err.code !== 'hardware_error'
        // A failed read cannot make an older snapshot current, even when the
        // device explicitly rejected the query.
        setStale((previous) => (op === 'state' || !rejected ? true : previous))
        setFeedback({ scope, kind: rejected ? 'error' : 'unknown', text: friendlyError(err) })
        log('失败', friendlyError(err))
      }
      return false
    } finally {
      lock.current = false
      setPending(null)
    }
  }
  return {
    link,
    changeLink,
    devices,
    target,
    setTarget,
    searching,
    searched,
    connectionError,
    status,
    hello,
    snapshot,
    stale,
    pending,
    feedback,
    samples,
    sampleEpoch,
    logs,
    ready,
    enabled,
    search,
    connect,
    disconnect,
    act,
    clearLogs: () => setLogs([]),
  }
}
