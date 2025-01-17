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

// -------------- KEY & PeerId FACTORY IMPORTS --------------
import { privateKeyFromRaw } from '@libp2p/crypto/keys'

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
      listen: [
        // Listen on circuit so we get a reservation
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
      relay: circuitRelayServer({
        advertise: false,
        //hop: { enabled: false }
      })
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
  // If you re-run, you should see the same PeerId each time

  // Wait until we see a circuit address like:
  // /ip4/.../tcp/.../p2p/<relayId>/p2p-circuit/p2p/<thisListenerId>
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

  // Finally, handle inbound connections on the /node-1 protocol
  listener.handle(
    '/node-1',
    async ({ stream }) => {
      console.log('Listener: received a /node-1 connection!')

      // Print everything from the dialer
      void pipe(
        stream.source,
        async function (source) {
          for await (const chunk of source) {
            console.log('[Dialer -> Listener]', uint8ArrayToString(chunk.subarray()))
          }
        }
      )

      // Also read console input -> dialer
      console.log('Type messages to send to the dialer:')
      void pipe(process.stdin, stream)
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