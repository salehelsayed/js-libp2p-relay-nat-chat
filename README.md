# js-libp2p-relay-nat-chat



## Listener
- **Private Key**: Uses a static Ed25519 private key for identity.  
- **Behind NAT**: Relies on the relay to be discoverable since it is not publicly reachable.  
- **Relay Reservation**: Connects to the relay and obtains a `/p2p-circuit` reservation so others can dial it via the relay’s address.  
- **Limited Connection Handling**: Accepts inbound connections even on a “LimitedConnection.”  
- **Connection Lifecycle**:  
  - If the dialer becomes idle and drops, the listener remains available.  
  - It gracefully handles stream-end or errors, and continues to accept new connections from any subsequent dialers.

---

## Dialer
- **Behind NAT**: Cannot accept direct incoming connections, so it also depends on the relay to reach the listener.  
- **Hardcoded Target**: Has the listener’s `/p2p-circuit` multiaddress embedded in the code.  
- **Initiates Connections**: Actively dials the listener using the relay’s circuit address.  
- **Limited Connection**: Supports dialing over “LimitedConnection” (transient or NAT-limited).  
- **Idle Timeout**: When idle, closes the stream automatically, requiring a new dial if needed.

---

## Relay
- **Private Key**: Uses its own static Ed25519 private key for identity.  
- **Public IP**: Deployed with a public IP so that NATed peers can connect to it for circuit relay.  
- **Relay (Hop) Enabled**: Allows other nodes to reserve circuit addresses (`/p2p-circuit`) for inbound connections.  
- **Reservation Limit**: Configured to support an unlimited (or very high) number of reservations for demonstration purposes.

---

### Usage Flow
1. **Start the Relay** (`node relay.js`): It will listen on a public interface and print out its multiaddresses.  
2. **Launch the Listener** (`node listener.js`):  
   - It prints out a `/p2p-circuit` address once it secures a reservation with the relay.  
   - This address is what the dialer needs to connect.  
3. **Run the Dialer** (`node dialer.js`):  
   - It uses the hardcoded `/p2p-circuit` multiaddress from the listener (on the same relay).  
   - When it connects, you can exchange messages interactively in the console.  

When the connection goes idle:  
- The **dialer** drops the stream, but  
- The **listener** remains running and can accept new dialers without restarting the process (unless you choose to stop it).

This setup demonstrates NAT traversal via circuit relay and basic chat over Libp2p.

## About `listener.js`
This file demonstrates how to set up a Libp2p node that obtains a “circuit relay reservation,” which means it connects to a relay node (specified by RELAY_ADDR) so it can receive inbound connections even if it’s behind a NAT or firewall.

1. It starts up a Libp2p node with:
   - A static private key (Ed25519).
   - Circuit relay transport (so it can listen on /p2p-circuit addresses).
   - Connection encryption (noise), stream multiplexing (yamux), and relay features.
2. The node connects to a known relay address (RELAY_ADDR) and requests a circuit reservation. Once successful, the node gets a “circuit-based” address that others can use to dial it, regardless of NAT or firewall restrictions.
3. The code continuously checks if the node has a circuit address and, once found, prints out its final set of addresses.
4. It listens for inbound connections on the protocol “/node-1” and sets up a simple text-based chat:
   - When a remote dialer connects, both sides can exchange messages in the terminal.
   - It uses a “pushable” stream to send data from the user’s keyboard input back to the remote dialer.
5. Basic error handling is built-in for unhandled promise rejections and uncaught exceptions to avoid accidental process termination.

Overall, `listener.js` is a simple yet illustrative “listening” example of how to leverage circuit relay for NAT traversal using Libp2p. After starting the script, it stays running to receive connections and exchange messages with peers—no direct or public IP is required, just a successful reservation through the relay.

## Comparison of `listener-old.js` and `listener.js`
The listener-old.js example is a simpler version of setting up a Libp2p node with circuit relay features. The listener3.js file includes additional functionality and refinements:

1. Unhandled Error Handling  
   listener3.js includes code to cleanly handle unexpected errors and promise rejections so the process won’t accidentally exit:
   ```javascript
   process.on('uncaughtException', (err) => {
     console.error('Uncaught exception in listener:', err)
   })

   process.on('unhandledRejection', (err) => {
     console.error('Unhandled promise rejection in listener:', err)
   })
   ```

2. More Robust Chat Handling via Pushable & Readline  
   In `listener-old.js`, console input is piped directly to the stream. In listener3.js, the “pushable” stream and a readline interface are introduced to manage inbound keyboard input and to handle multiple incoming connections more gracefully. For instance:
   ```javascript
   import { pushable } from 'it-pushable'
   import readline from 'readline'

   // ...
   // Create a single readline interface for the entire process
   const rl = readline.createInterface({
     input: process.stdin,
     output: process.stdout
   })

   // We'll use a pushable to handle sending bytes to the stream
   const inputQueue = pushable()

   // This function is called each time the user presses Enter
   const onLine = (line) => {
     inputQueue.push(new TextEncoder().encode(line + '\n'))
   }

   rl.on('line', onLine)
   ```

   This approach allows listener.js to:
   • Keep the script running for multiple inbound connections.  
   • Cleanly end the text stream when the remote dialer disconnects.  

3. Displaying Detailed Logs and Keeping the Node Running  
   listener.js logs additional events (e.g., when the dialer’s stream ends) and maintains the user input prompt, letting multiple persistent connections be handled in the same process.

Together, these enhancements in listener3.js make it more robust and user-friendly than `listener-old.js`, particularly for a persistent chat scenario behind NAT or firewalls.


# Flutter integration
Below is an **overview** of what changes you’d typically make when **moving** the same logic to a **Flutter** (Android/iOS) environment, **rather than** using Node.js console and `readline` APIs. This applies to both **listener** and **dialer** code.

---

## 1) Remove Node-Specific I/O

- **Node.js** uses things like:
  - `readline`  
  - `process.stdin`, `process.stdout`  
  - `console.log` (though you can still use console-like logs in certain JS bridging scenarios, but typically you’d use Flutter’s logging)

In **Flutter**, you do **not** have a direct “console” or `readline`. Instead:

1. **User Interface**: You have **TextField** widgets, “Send” buttons, etc.  
2. **Async Streams**: Flutter or Dart code typically uses **Streams** or a callback method to read user input.  

**So, you’d remove or replace**:
```js
import readline from 'readline'

const rl = readline.createInterface(...)
...
rl.on('line', onLine)
```
and any references to `process.stdin` or `process.on('uncaughtException', ...)`.

---

## 2) Provide a “Send Message” Method in Flutter

Where your Node.js code has:

```js
// For the dialer:
// pipe(process.stdin, stream)

// For the listener:
// read console input -> dialer
// using readline or pushable
```

**In Flutter**, you might have a function, for example:

```dart
void sendMessage(String message) {
  // Convert to bytes and push to the libp2p stream
}
```

You’d call `sendMessage(...)` when a user taps a “Send” button. Internally, that calls your bridging code to do:

```js
inputQueue.push(new TextEncoder().encode(message + '\n'))
```
(if you’re using the pushable approach on the Listener side, or a similar approach for the Dialer).

---

## 3) Replace `console.log` with Flutter Logging or UI

- In Node, you do `console.log('some info')`.  
- In Flutter, you might:
  - Use `debugPrint(...)` or `print(...)` to log to the debug console, **or**  
  - Show messages in the app’s UI (e.g., append them to a chat list).  

Hence, any time the Node code does `console.log(...)`, you’d either remove it or replace it with a Flutter function that updates the UI or logs to the console in Dart.

---

## 4) Handling “Incoming Messages” in Flutter

Currently, the **Listener** code does something like:

```js
for await (const chunk of stream.source) {
  console.log('[Dialer -> Listener]', uint8ArrayToString(chunk.subarray()))
}
```

In Flutter, you wouldn’t log to a Node console. Instead:

1. You’d call a **callback** or **stream** in Dart that updates your chat UI.  
2. For instance, in your bridging layer, whenever a chunk arrives, you pass it to Dart code to display the text message in the UI.

---

## 5) Remove `process.on('uncaughtException', ...)`

In a Flutter environment (or any pure JS code running under a different runtime), you typically **don’t** have Node’s `process.on(...)`. You handle errors in your **Dart** code or your bridging layer’s `try/catch`. So, remove or omit:

```js
process.on('uncaughtException', ...)
process.on('unhandledRejection', ...)
```

---

## 6) Keep the libp2p Configuration, but Bridge or Compile for Flutter

- The **libp2p** config with `createLibp2p`, your DHT settings, `relay: circuitRelayServer`, and so on can remain **similar**.  
- You just can’t run it as a Node script with `process.exit(1)`. Instead, you would run it in:
  - A **JavaScript bridging** environment in Flutter (e.g., a plugin or embedded V8/QuickJS engine).  
  - Or a **Dart**-native port of libp2p (if/when that’s available) with a matching configuration.  

In short, the **networking logic** (transports, circuit relay usage, etc.) stays largely the same, but you adapt how you **start** the node and handle input/output.

---

## 7) Summary of Key Changes

1. **Remove all Node.js specifics** (`readline`, `process.stdin`, `process.on(...)`, `console.log` for user I/O).  
2. **Expose “send message” methods** that Flutter can call to feed data into the libp2p stream.  
3. **Handle incoming stream data** by updating the Flutter UI or calling a Dart callback, instead of printing to Node console.  
4. **No `process.exit(...)`** in Flutter; you just manage the node’s lifecycle in your app’s code.  
5. **Same libp2p config**: You still set up the DHT, the Relay transport, etc., but all “console input” or “console output” must become **UI-based** or **logging** in Flutter.

With these changes, your app logic remains the same in principle (one side dials, the other listens, they exchange messages), but the user interface and error handling shift from Node console to Flutter’s UI and logging.