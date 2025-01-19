import { createLibp2p } from 'libp2p'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { mplex } from '@libp2p/mplex'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { identify, identifyPush } from '@libp2p/identify'
import { kadDHT } from '@libp2p/kad-dht'
import { ping } from '@libp2p/ping'
import { webSockets } from '@libp2p/websockets'
import * as filters from '@libp2p/websockets/filters'
import { privateKeyFromRaw } from '@libp2p/crypto/keys'

const privateKeyRaw = Uint8Array.from([
  3, 98, 126, 31, 53, 38, 77, 83, 95, 52, 208,
  245, 12, 231, 179, 29, 77, 119, 64, 225, 28, 76,
  152, 60, 22, 170, 169, 92, 240, 114, 50, 34, 97,
  34, 166, 6, 69, 146, 135, 77, 74, 250, 62, 215,
  106, 6, 45, 2, 118, 162, 136, 195, 108, 174, 61,
  180, 216, 136, 89, 9, 101, 139, 157, 193
])

async function main () {
  const relayNode = await createLibp2p({
    privateKey: privateKeyFromRaw(privateKeyRaw),
    addresses: {
      listen: ['/ip4/0.0.0.0/tcp/3001/ws'],
      announce: ['/ip4/13.60.15.36/tcp/3001/ws']
    },
    transports: [
      webSockets({
        filter: filters.all
      })
    ],
    connectionEncrypters: [noise()],

    // Provide BOTH yamux and mplex, so we can handle either
    streamMuxers: [yamux(), mplex()],

    services: {
      // DHT in server mode
      dht: kadDHT({
        // remove custom protocol
        protocol: '/ipfs/saleh/kad/1.0.0',
        clientMode: false
      }),
      identify: identify(),
      identifyPush: identifyPush(),
      ping: ping(),
      relay: circuitRelayServer({
        hop: { enabled: true },
        reservations: {
          maxReservations: Infinity
        }
      })
    }
  })
  await relayNode.start()


  console.log('Relay node is up! Relay multiaddrs:')
  relayNode.getMultiaddrs().forEach(ma => {
    console.log(ma.toString())
  })

  relayNode.addEventListener('peer:discovery', evt => {
    console.log('Relay discovered:', evt.detail.id.toString())
  })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})