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
const privateKeyRawB = Uint8Array.from([
  134, 198,  31,  60, 186, 194, 147,  53, 177,  50, 188,
  209,  75, 154, 172,  40,  87, 250,  31,   4, 109, 240,
    9,  79,  71, 225, 150,  61, 151,  21,  28, 210, 178,
  170, 147, 218, 159,  63, 182, 198, 104,  43, 177, 102,
   93,  31, 201,  11, 179, 165, 218, 194, 200, 202,   2,
  181, 250,  84,  69,  12,   0, 238,  45, 124
])

// Known relay multiaddr
const RELAY_ADDR = '/ip4/13.60.15.36/tcp/3001/ws/p2p/12D3KooWGMYMmN1RGUYjWaSV6P3XtnBjwnosnJGNMnttfVCRnd6g'

// 2) MAIN
async function main () {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  const userB = await createLibp2p({
    privateKey: privateKeyFromRaw(privateKeyRawB),
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

  await userB.start()
  console.log('User B started with peerId:', userB.peerId.toString())

  // Dial the relay
  try {
    await userB.dial(multiaddr(RELAY_ADDR))
    console.log('UserB is now connected to the relay.')
  } catch (err) {
    console.error('Failed to dial relay:', err)
  }

  await waitForCircuitAddress(userB)

  const addrs = userB.getMultiaddrs().map(a => a.toString())
  console.log('User B circuit addresses:')
  addrs.forEach(a => console.log('  ', a))
  console.log('Give one of these addresses to userA if they need to dial you.\n')

  // C) Inbound “/node-1” handling
  userB.handle('/node-1', async ({ stream }) => {
    console.log('UserB: inbound stream on /node-1!')

    // REMOTE -> console
    void (async () => {
      try {
        for await (const chunk of stream.source) {
          console.log('[UserA -> UserB]', uint8ArrayToString(chunk.subarray()))
        }
      } catch (err) {
        if (err?.name === 'StreamResetError') {
          console.log('UserB: inbound stream was reset by remote or network.')
        } else {
          console.error('UserB inbound stream error:', err)
        }
      } finally {
        console.log('UserB: inbound stream ended or dropped.')
        inputQueue.end()
        removeLineListener()
      }
    })()

    // console -> remote
    // Create a new pushable + line listener for this inbound connection
    const { inputQueue, removeLineListener } = createPushableWithLineListener(rl)
    void pipe(inputQueue, stream)

    console.log('Type to send to inbound connection:')
  }, {
    maxInboundStreams: 32,
    runOnLimitedConnection: true
  })

  // D) Provide a way to dial userA
  console.log('Type "/dialA <multiaddr>" to dial userA:')
  rl.on('line', async (line) => {
    if (!line.startsWith('/dialA ')) {
      return
    }
    const parts = line.split(' ')
    if (parts.length < 2) {
      console.log('Usage: /dialA <multiaddr>')
      return
    }

    const userACircuitMaStr = parts[1]
    console.log(`UserB: using circuit multiaddr from userA: ${userACircuitMaStr}`)

    const userACircuitMa = multiaddr(userACircuitMaStr)
    const splitted = userACircuitMa.toString().split('/p2p/')
    if (splitted.length < 2) {
      console.log('Invalid multiaddr: missing /p2p/<peerId>')
      return
    }
    const userAPeerIdStr = splitted[splitted.length - 1]
    const userAPeerId = peerIdFromString(userAPeerIdStr)
    await userB.peerStore.patch(userAPeerId, {
      multiaddrs: [userACircuitMa]
    })
    console.log('UserB: patched userA multiaddr into peerStore.')

    // Dial userA on /node-1
    try {
      const options = {
        maxOutboundStreams: 10,
        runOnLimitedConnection: true,
        negotiateFully: true
      }
      const stream = await userB.dialProtocol(userAPeerId, ['/node-1'], options)
      console.log('UserB: connected to userA on /node-1 stream!')

      // console -> userA (line-based)
      // We do the same approach: new pushable + line listener
      const { inputQueue, removeLineListener } = createPushableWithLineListener(rl)
      void pipe(inputQueue, stream)

      console.log('Type messages to send to userA:')

      // userA -> console
      void pipe(stream.source, async (source) => {
        try {
          for await (const chunk of source) {
            console.log('[UserA -> UserB]', uint8ArrayToString(chunk.subarray()))
          }
        } catch (err) {
          if (err?.name === 'StreamResetError') {
            console.log('UserB: outbound stream was reset by userA or network.')
          } else {
            console.error('UserB outbound stream error:', err)
          }
        } finally {
          console.log('UserB: outbound stream ended or dropped.')
          inputQueue.end()
          removeLineListener()
        }
      })
    } catch (err) {
      console.error('UserB: failed to dial userA:', err)
    }
  })

  userB.addEventListener('peer:discovery', (evt) => {
    console.log('UserB discovered peer:', evt.detail.id.toString())
  })
}

// Utility: wait for a circuit address
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

// Utility: create a new pushable + 'line' listener
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
  console.error('UserB main error:', err)
  process.exit(1)
})
