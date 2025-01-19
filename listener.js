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

import { pipe } from 'it-pipe'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import { privateKeyFromRaw } from '@libp2p/crypto/keys'
import { pushable } from 'it-pushable'
import readline from 'readline'

// --- 1) Catch all unhandled errors so the process doesn't exit ---
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in listener:', err)
  // Decide if you can recover or just log
})

process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection in listener:', err)
  // Decide if you can recover or just log
})

// This is your static Ed25519 private key raw bytes (example)
const privateKeyRaw = Uint8Array.from([
  193, 47, 231, 144, 7, 129, 84, 20, 140, 231,
  61, 69, 132, 95, 229, 213, 117, 243, 170, 134,
  53, 107, 201, 227, 231, 86, 245, 138, 253, 246,
  233, 46, 139, 233, 131, 150, 161, 171, 243, 137,
  84, 240, 69, 183, 161, 43, 61, 29, 107, 242,
  173, 213, 11, 185, 85, 190, 173, 171, 76, 174,
  208, 184, 101, 146
])

// The relay we want to connect to, so it can give us a circuit reservation
const RELAY_ADDR = '/ip4/13.60.15.36/tcp/3001/ws/p2p/12D3KooWGMYMmN1RGUYjWaSV6P3XtnBjwnosnJGNMnttfVCRnd6g'

async function main () {
  const listener = await createLibp2p({
    privateKey: privateKeyFromRaw(privateKeyRaw),
    addresses: {
      // Listen on circuit so we get a reservation
      listen: [
        '/p2p-circuit'
      ]
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
        // Only allow circuit or the known relay IP
        if (!maStr.includes('p2p-circuit') && !maStr.includes('13.60.15.36')) {
          return true
        }
        return false
      }
    },

    services: {
      dht: kadDHT({ clientMode: true }),
      identify: identify(),
      identifyPush: identifyPush(),
      ping: ping(),
    },

    // Discover the relay, so we dial out for the reservation
    peerDiscovery: [
      bootstrap({
        list: [RELAY_ADDR]
      })
    ],

    // Example connection limits
    connectionManager: {
      maxConnections: 300,
      maxIncomingPendingConnections: 50,
      inboundConnectionThreshold: 100
    }
  })

  await listener.start()
  console.log('Listener started with peerId:', listener.peerId.toString())

  // Wait until we see a circuit address
  await new Promise(resolve => {
    const iv = setInterval(() => {
      const addrs = listener.getMultiaddrs().map(ma => ma.toString())
      const hasCircuitAddr = addrs.some(addr => addr.includes('/p2p-circuit/p2p/'))
      if (hasCircuitAddr) {
        clearInterval(iv)
        resolve(true)
      }
    }, 1000)
  })

  // Show the addresses
  const observedAddresses = listener.getMultiaddrs().map(ma => ma.toString())
  console.log('Listener addresses (after reservation):', observedAddresses)
  console.log('You can share your /p2p-circuit address with others so they can dial you.')

  // Create a single readline interface for the entire process
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  // Handle inbound connections on the /node-1 protocol
  listener.handle(
    '/node-1',
    async ({ stream }) => {
      console.log('Listener: received a /node-1 connection!')

      // 1) SET UP READING FROM THE DIALER (parallel)
      void (async () => {
        try {
          for await (const chunk of stream.source) {
            console.log('[Dialer -> Listener]', uint8ArrayToString(chunk.subarray()))
          }
        } catch (err) {
          // If it's a StreamResetError, log a friendlier message
          if (err?.name === 'StreamResetError') {
            console.log('Listener: the stream was reset by the dialer or network.')
          } else {
            console.error('Listener: stream read error:', err)
          }
        } finally {
          console.log('Listener: stream from Dialer ended or was dropped.')

          // 2) Stop pushing data to the dialer
          inputQueue.end()
          rl.off('line', onLine)
        }
      })()

      // We'll use a pushable to handle sending bytes to the stream
      const inputQueue = pushable()

      // Pipe pushable -> the dialer's stream
      void pipe(
        inputQueue,
        stream
      )

      // This function is called each time the user presses Enter
      const onLine = (line) => {
        // Convert text to bytes + newline
        inputQueue.push(new TextEncoder().encode(line + '\n'))
      }

      // Attach the line listener
      rl.on('line', onLine)

      console.log('Type messages to send to the dialer:')
      console.log('Listener remains active and can accept new connections.')
    },
    {
      maxInboundStreams: 32,
      runOnLimitedConnection: true
    }
  )
}

main().catch(err => {
  console.error('Listener main error:', err)
  process.exit(1)
})
