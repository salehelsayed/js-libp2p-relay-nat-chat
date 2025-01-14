/**
 * dialer-optionA.js
 *
 * 1) Connects to the relay
 * 2) Dials the listener’s circuit address
 * 3) Pipes the dialer’s console input directly to the listener
 * 4) Pipes anything from the listener to the dialer’s console
 */

import { createLibp2p } from 'libp2p'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayTransport, circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { identify, identifyPush } from '@libp2p/identify'
import { kadDHT } from '@libp2p/kad-dht'
import { ping } from '@libp2p/ping'
import { webSockets } from '@libp2p/websockets'
import * as filters from '@libp2p/websockets/filters'
import { bootstrap } from '@libp2p/bootstrap'
import { multiaddr } from '@multiformats/multiaddr'
import { peerIdFromString } from '@libp2p/peer-id'
import { pipe } from 'it-pipe'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'

// The relay's publicly reachable multiaddr
const RELAY_ADDR = '/ip4/13.60.15.36/tcp/3001/ws/p2p/12D3KooWGMYMmN1RGUYjWaSV6P3XtnBjwnosnJGNMnttfVCRnd6g'

// The listener’s circuit multiaddr from the same relay
// e.g. /ip4/.../tcp/.../ws/p2p/QmRelayID/p2p-circuit/p2p/QmListenerID
const LISTENER_CIRCUIT_MA =
  '/ip4/13.60.15.36/tcp/3001/ws/p2p/12D3KooWGMYMmN1RGUYjWaSV6P3XtnBjwnosnJGNMnttfVCRnd6g/p2p-circuit/p2p/12D3KooWKEXMpZ1An7wvoUdckhESPFh2zJWSNFFN7GwkGvPFUZ37'
async function main () {
  const dialer = await createLibp2p({
    addresses: {
      // Force usage of relay-based addresses only
      listen: ['/p2p-circuit']
    },
    transports: [
      webSockets({ filter: filters.all }),
      circuitRelayTransport()
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    connectionGater: {
      denyDialMultiaddr: (addr) => {
        const maStr = addr.toString()
        if (!maStr.includes('p2p-circuit') && !maStr.includes('13.60.15.36')) {
          return true
        }
        return false
      }
    },
    services: {
      // NATed node typically runs the DHT in client mode
      dht: kadDHT({ clientMode: true }),
      identify: identify(),
      identifyPush: identifyPush(),
      ping: ping(),
      relay: circuitRelayServer({
        advertise: false,
        hop: { enabled: false }
      })
    },
    peerDiscovery: [
      bootstrap({
        list: [RELAY_ADDR]
      })
    ]
  })

  await dialer.start()
  console.log('Dialer started with peerId:', dialer.peerId.toString())

  // Wait for a relay reservation
  await new Promise(resolve => {
    const iv = setInterval(() => {
      const addrs = dialer.getMultiaddrs().map(ma => ma.toString())
      const hasCircuitAddr = addrs.some(addr => addr.includes('/p2p-circuit/p2p/'))
      if (hasCircuitAddr) {
        clearInterval(iv)
        resolve(true)
      }
    }, 1000)
  })

  console.log(
    'Dialer addresses (after reservation):',
    dialer.getMultiaddrs().map(ma => ma.toString())
  )

  // Extract the listener peer ID from the circuit multiaddr
  const circuitMa = multiaddr(LISTENER_CIRCUIT_MA)
  const parts = circuitMa.toString().split('/p2p/')
  const listenerPeerIdStr = parts[parts.length - 1]
  const listenerPid = peerIdFromString(listenerPeerIdStr)

  // Patch the listener multiaddr into our peer store
  await dialer.peerStore.patch(listenerPid, {
    multiaddrs: [circuitMa]
  })

  console.log(`Dialer: dialing /node-1 at:\n  ${LISTENER_CIRCUIT_MA}`)
  try {
    const options = {
      maxOutboundStreams: 10,
      runOnLimitedConnection: true,
      negotiateFully: true
    }
    // Dial the /node-1 protocol
    const stream = await dialer.dialProtocol(listenerPid, ['/node-1'], options)
    console.log('Dialer: opened /node-1 stream to the listener!')

    // Just pipe console input → listener
    console.log('Type messages to send to the listener:')
    void pipe(process.stdin, stream)

    // Print anything the listener sends
    void pipe(
      stream.source,
      async function (source) {
        for await (const chunk of source) {
          console.log('[Listener -> Dialer]', uint8ArrayToString(chunk.subarray()))
        }
      }
    )
  } catch (err) {
    console.error('Dialer: failed to dialProtocol /node-1:', err)
  }
}

main().catch(err => {
  console.error('Dialer main error:', err)
  process.exit(1)
})
