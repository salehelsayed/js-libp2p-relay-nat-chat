# js-libp2p-relay-nat-chat 1.2

This repository showcases **two NATed peers** communicating over **libp2p** via a **public Relay**. Each NATed peer (User A, User B) can both **listen** on a circuit address *and* **dial** another peer’s circuit address. The relay is a publicly reachable node configured to allow circuit reservations and forward traffic for behind-NAT peers.

## Table of Contents

1. [Overview](#overview)  
2. [Relay](#relay)  
3. [User A & User B](#user-a--user-b)  
4. [Usage Flow](#usage-flow)  
5. [Error Handling](#error-handling)  
6. [Additional Notes](#additional-notes)  
7. [generateKey.js](#generatekeyjs)

---

## Overview

- **Relay** (in `relay.js`):
  - A public node with `hop` enabled.  
  - Listens on a public interface.  
  - Allows `/p2p-circuit` reservations so NATed peers can receive inbound connections.

- **User A** and **User B** (in `userA.js` and `userB.js` respectively):
  - Each has a **static Ed25519** private key embedded in code (for demo/testing).
  - Both **listen** on `/p2p-circuit` addresses, so the Relay can forward inbound traffic to them.
  - Both can **dial** another user’s circuit address (so they can connect to each other via the Relay).
  - Each node has console-based chat logic using `readline` and `it-pushable`.

By using circuit relay, both NATed peers can “meet” on the Relay and exchange data without having direct public IP addresses.

---

## Relay

- **Location**: `relay.js`
- **Key Configuration**:
  - Uses a static key (`privateKeyRaw`) for demonstration (not recommended for production).
  - Exposes a WebSocket interface (e.g., `listen: ['/ip4/0.0.0.0/tcp/3001/ws']`).
  - Announces a public IP, e.g. `announce: ['/ip4/13.60.15.36/tcp/3001/ws']`.
  - `hop: { enabled: true }` so it will forward traffic on behalf of NATed peers.
  - DHT runs in server mode to facilitate discovery.

When you start it:
```bash
node relay.js
```
It prints out something like:
```
Relay node is up! Relay multiaddrs:
  /ip4/0.0.0.0/tcp/3001/ws/p2p/<RelayPeerId>
```
with the publicly announced address. That address is what **User A** and **User B** use as `RELAY_ADDR`.

---

## User A & User B

Both `userA.js` and `userB.js` have a very similar structure:

- A **static Ed25519** key in the code for testing.  
- `addresses.listen = ['/p2p-circuit']`, allowing inbound circuit connections from the Relay.  
- Each **dials** the Relay for a “reservation,” so the Relay can route traffic to them.  
- They each can discover the Relay via `bootstrap({ list: [RELAY_ADDR] })`.  
- Once they connect to the Relay, they show their new “circuit-based addresses” (something like `/ip4/<relay-ip>/tcp/<port>/ws/p2p/<relayId>/p2p-circuit/p2p/<UserId>`).
- **Inbound** connections on `/node-1` are handled by a callback, which sets up a **simple chat** pipeline using `readline` + `it-pushable`.
- **Outbound** connections can be initiated by typing commands like:
  - For **User A**: `"/dialB <multiaddr>"` (the multiaddr of User B).
  - For **User B**: `"/dialA <multiaddr>"` (the multiaddr of User A).

---

## Usage Flow

1. **Start the Relay**:
   ```bash
   node relay.js
   ```
   - It logs its multiaddresses. One of them is the “public” one you’ll use in your userA/userB code under `RELAY_ADDR`.

2. **Launch User A**:
   ```bash
   node userA.js
   ```
   - On startup, it dials the relay.  
   - It then obtains a circuit address. You’ll see something like:
     ```
     User A circuit addresses:
       /ip4/13.60.15.36/tcp/3001/ws/p2p/<RelayId>/p2p-circuit/p2p/<UserAId>
     ```
   - That address can be given to **User B** if B wants to dial A.

3. **Launch User B**:
   ```bash
   node userB.js
   ```
   - B also dials the relay.  
   - B obtains its own circuit address (printed to console). If B wants A to dial it, it can share that address with A.

4. **Dialing**:
   - **If A wants to dial B** (and B gave its multiaddr):  
     ```bash
     /dialB /ip4/13.60.15.36/tcp/3001/ws/p2p/<RelayId>/p2p-circuit/p2p/<UserBId>
     ```
     - Once connected, type lines in the console to send messages, which appear on B’s console.

   - **If B wants to dial A** (and A gave its multiaddr):
     ```bash
     /dialA /ip4/13.60.15.36/tcp/3001/ws/p2p/<RelayId>/p2p-circuit/p2p/<UserAId>
     ```

5. **Chat**:
   - Once a stream is open, typed lines on your console are sent to the other side, and lines from the remote appear in your console with a `[Remote -> …]` tag.

---

## Error Handling

Each user’s code includes **try/catch** and **finally** blocks around the inbound/outbound streams:

- **`StreamResetError`**: If the remote or network forcibly closes the stream, it’s caught and logged as “the stream was reset.”  
- On `finally`, the code cleans up: ends the pushable queue, stops listening for user input on that connection.  
- This means the user process **remains running** even if a stream ends. The user can **dial** again or accept new inbound calls without restarting the process.

If you see logs like “Cannot push value onto an ended pushable,” that generally means the user typed more lines after the stream ended. The code now detaches line listeners once the stream is done, so subsequent lines do not go to a dead stream.  

---

## Additional Notes

1. **NAT**: By listening on `/p2p-circuit` only, neither user needs a public IP. The Relay’s IP is public, and it relays traffic.  
2. **DHT**: Each user runs the DHT in `clientMode: true`, so they do minimal routing table management.  
3. **Random-Walk**: By default, the Kademlia DHT runs random walks for peer discovery, so you may see occasional “randomwalk errored” logs. These are harmless.  
4. **Static Keys**: For a production scenario, you’d generate keys once and store them securely, not commit them to source.  
5. **Multiple Streams**: The code supports multiple inbound/outbound streams over the same relay connection, though each new dial or inbound call spawns a new pushable queue and line listener.  

---

## generateKey.js

**Location**: `generateKey.js`

This script generates a **static Ed25519 key pair** for use in libp2p, letting you **hard-code** a peer’s private key so the node’s **Peer ID remains consistent** across runs.  
 
**How It Works**:

1. It calls:
   ```js
   import { generateKeyPair, privateKeyToProtobuf } from '@libp2p/crypto/keys'
   
   const privateKey = await generateKeyPair('Ed25519')
   ```
   returning an object with the **64-byte** Ed25519 private key plus a 32-byte public key.

2. It also logs a **protobuf-encoded** version via:
   ```js
   const protobufBytes = privateKeyToProtobuf(privateKey)
   ```
   which libp2p typically uses internally to store private keys.

**Example Output**:
```
privateKey
Ed25519PrivateKey { 
  type: 'Ed25519', 
  raw: Uint8Array(64) [...], 
  publicKey: Ed25519PublicKey { ... } 
}

protobufBytes
Uint8Array(68) [ ... ]
```

**Using the Generated Key**:

- Copy the **`raw`** array into your code (e.g., `userB.js`), such as:
  ```js
  const privateKeyRawB = Uint8Array.from([
    134, 198, 31, ...
  ])
  ```
- Use it in libp2p config:
  ```js
  import { privateKeyFromRaw } from '@libp2p/crypto/keys'
  
  const userB = await createLibp2p({
    privateKey: privateKeyFromRaw(privateKeyRawB),
    // ...
  })
  ```
- Now your user node has a **stable** peer ID derived from this key.

This approach is recommended only for demonstrations or testing; in **real** deployments, you’d generate and manage keys securely (not in source code).

---

**Enjoy** experimenting with **User A** and **User B** behind NAT, chatting via the **Relay**—all using **libp2p**!