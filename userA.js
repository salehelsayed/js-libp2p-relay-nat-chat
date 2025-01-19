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
import { peerIdFromString } from '@libp2p/peer-id'
import { privateKeyFromRaw } from '@libp2p/crypto/keys'
import { pipe } from 'it-pipe'
import { pushable } from 'it-pushable'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import readline from 'readline'
import { multiaddr } from '@multiformats/multiaddr'

// 1) CONFIG
const privateKeyRawA = Uint8Array.from([
  193,  47, 231, 144,   7, 129,  84,  20, 140, 231,
   61,  69, 132,  95, 229, 213, 117, 243, 170, 134,
   53, 107, 201, 227, 231,  86, 245, 138, 253, 246,
  233,  46, 139, 233, 131, 150, 161, 171, 243, 137,
   84, 240,  69, 183, 161,  43,  61,  29, 107, 242,
  173, 213,  11, 185,  85, 190, 173, 171,  76, 174,
  208, 184, 101, 146
])

// Known relay multiaddr
const RELAY_ADDR = '/ip4/13.60.15.36/tcp/3001/ws/p2p/12D3KooWGMYMmN1RGUYjWaSV6P3XtnBjwnosnJGNMnttfVCRnd6g'

// 2) MAIN
async function main () {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  const userA = await createLibp2p({
    privateKey: privateKeyFromRaw(privateKeyRawA),
    addresses: {
      listen: ['/p2p-circuit']
    },
    transports: [
      webSockets({ filter: filters.all }),
      circuitRelayTransport()
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      dht: kadDHT({ clientMode: true }),
      identify: identify(),
      identifyPush: identifyPush(),
      ping: ping(),
      relay: circuitRelayServer({
        advertise: false
      })
    },
    peerDiscovery: [
      bootstrap({ list: [RELAY_ADDR] })
    ]
  })

  await userA.start()
  console.log('User A started with peerId:', userA.peerId.toString())

  // Dial the relay
  try {
    await userA.dial(multiaddr(RELAY_ADDR))
    console.log('UserA is now connected to the relay.')
  } catch (err) {
    console.error('Failed to dial relay:', err)
  }

  await waitForCircuitAddress(userA)

  const addrs = userA.getMultiaddrs().map(a => a.toString())
  console.log('User A circuit addresses:')
  addrs.forEach(a => console.log('  ', a))
  console.log('Give one of these addresses to userB if they need to dial you.\n')

  // E) Inbound "/node-1"
  userA.handle('/node-1', async ({ stream }) => {
    console.log('UserA: inbound stream on /node-1!')

    // REMOTE -> console
    void (async () => {
      try {
        for await (const chunk of stream.source) {
          console.log('[Remote -> UserA]', uint8ArrayToString(chunk.subarray()))
        }
      } catch (err) {
        if (err?.name === 'StreamResetError') {
          console.log('UserA: inbound stream was reset by remote or network.')
        } else {
          console.error('UserA inbound stream error:', err)
        }
      } finally {
        console.log('UserA: inbound stream ended or dropped.')
        inputQueue.end()
        removeLineListener()
      }
    })()

    // console -> remote
    const { inputQueue, removeLineListener } = createPushableWithLineListener(rl)
    void pipe(inputQueue, stream)

    console.log('Type to send to the inbound connection:')
  }, {
    maxInboundStreams: 32,
    runOnLimitedConnection: true
  })

  // F) Dial userB by multiaddr
  console.log('Type "/dialB <multiaddr>" to dial userB.\n' +
    'e.g. /dialB /ip4/13.60.15.36/tcp/3001/ws/p2p/<relayId>/p2p-circuit/p2p/<UserBId>\n')

  rl.on('line', async (line) => {
    if (!line.startsWith('/dialB ')) {
      return
    }
    const parts = line.split(' ')
    if (parts.length < 2) {
      console.log('Usage: /dialB <multiaddr>')
      return
    }

    const userBCircuitMaStr = parts[1]
    console.log(`UserA: using circuit multiaddr from userB: ${userBCircuitMaStr}`)

    const userBCircuitMa = multiaddr(userBCircuitMaStr)
    const splitted = userBCircuitMa.toString().split('/p2p/')
    if (splitted.length < 2) {
      console.log('Invalid multiaddr: missing /p2p/<peerId>')
      return
    }
    const userBPeerIdStr = splitted[splitted.length - 1]
    const userBPeerId = peerIdFromString(userBPeerIdStr)

    await userA.peerStore.patch(userBPeerId, {
      multiaddrs: [userBCircuitMa]
    })
    console.log('UserA: patched userB multiaddr into peerStore.')

    // Dial userB
    try {
      const options = {
        maxOutboundStreams: 10,
        runOnLimitedConnection: true,
        negotiateFully: true
      }
      const stream = await userA.dialProtocol(userBPeerId, ['/node-1'], options)
      console.log('UserA: connected to userB on /node-1 stream!')

      console.log('Type messages to send to userB:')
      const { inputQueue, removeLineListener } = createPushableWithLineListener(rl)
      void pipe(inputQueue, stream)

      // userB -> console
      void pipe(stream.source, async (source) => {
        try {
          for await (const chunk of source) {
            console.log('[UserB -> UserA]', uint8ArrayToString(chunk.subarray()))
          }
        } catch (err) {
          if (err?.name === 'StreamResetError') {
            console.log('UserA: outbound stream was reset by userB or network.')
          } else {
            console.error('UserA outbound stream error:', err)
          }
        } finally {
          console.log('UserA: outbound stream ended or dropped.')
          inputQueue.end()
          removeLineListener()
        }
      })
    } catch (err) {
      console.error('UserA: failed to dial userB:', err)
    }
  })

  userA.addEventListener('peer:discovery', (evt) => {
    console.log('UserA discovered peer:', evt.detail.id.toString())
  })
}

// Utility: wait for circuit address
async function waitForCircuitAddress (node) {
  return new Promise(resolve => {
    const iv = setInterval(() => {
      const hasCircuit = node.getMultiaddrs().some(a => a.toString().includes('/p2p-circuit/p2p/'))
      if (hasCircuit) {
        clearInterval(iv)
        resolve(true)
      }
    }, 1000)
  })
}

// Utility: create new pushable + 'line' callback
function createPushableWithLineListener (rl) {
  const inputQueue = pushable()
  const onLine = (line) => {
    inputQueue.push(new TextEncoder().encode(line + '\n'))
  }
  rl.on('line', onLine)

  return {
    inputQueue,
    removeLineListener: () => rl.off('line', onLine)
  }
}

main().catch(err => {
  console.error('UserA main error:', err)
  process.exit(1)
})
