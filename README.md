Below is a sample **README.md** that you can place in your project root. It covers:

1. **How to install Node.js**  
2. **What each file (`relay.js`, `listener.js`, and `dialer.js`) does**  
3. **How to test/run the setup**  

Feel free to adjust any wording or specifics to fit your project’s context.

---

# Relay NAT Chat Foundation

This project demonstrates a simple Libp2p-based setup where one node acts as a **relay**, another as a **listener** (receiving inbound connections), and a third as a **dialer** (initiating connections). It showcases how to traverse NATs and connect peers via a relay.

## 1. Installing Node.js

### Windows

1. Go to the [Node.js Official Download Page](https://nodejs.org/en/download/).  
2. Download the Windows Installer (either 32-bit or 64-bit depending on your system).  
3. Run the installer and follow the prompts.  
4. Verify the installation by opening **Command Prompt** (or **PowerShell**) and running:
   ```bash
   node -v
   npm -v
   ```
   You should see version numbers for both Node.js (`node`) and NPM (`npm`).

### macOS

1. Go to the [Node.js Official Download Page](https://nodejs.org/en/download/).  
2. Download the macOS Installer.  
3. Open the downloaded `.pkg` file and follow the installation steps.  
4. Verify the installation by opening **Terminal** and running:
   ```bash
   node -v
   npm -v
   ```

### Linux (Ubuntu/Debian)

1. Open a **Terminal**.
2. Update and install the Node.js package:
   ```bash
   sudo apt-get update
   sudo apt-get install -y nodejs npm
   ```
   Or install a more recent version by adding NodeSource repositories (recommended):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
3. Verify the installation:
   ```bash
   node -v
   npm -v
   ```

For other distributions or more detailed instructions, check the [official Node.js documentation](https://nodejs.org/en/download/package-manager/).

---

## 2. Project Overview

This repository contains three main JavaScript files that use [Libp2p](https://github.com/libp2p/js-libp2p) to demonstrate NAT traversal, relaying, and peer-to-peer connections.

### Files

1. **`relay.js`**  
   - Spins up a **relay** node that listens for inbound connections on a public interface/port.  
   - It enables Circuit Relay V2 so that other peers can reserve a relay slot and route their traffic through it.  
   - Advertises the public multiaddress for peers to discover and dial.

2. **`listener.js`**  
   - Creates a **listener** node that connects to the relay to obtain a **circuit reservation**.  
   - Once reserved, the listener can receive inbound connections on its circuit address.  
   - Handles incoming messages on a custom protocol (`/node-1`).

3. **`dialer.js`**  
   - Creates a **dialer** node that also connects to the same relay.  
   - Dials the listener node using the listener’s relay-based circuit address.  
   - Exchanges messages with the listener over the `node-1` protocol.

---

## 3. How to Test and Run

### Prerequisites

1. **Node.js** (version 20+ recommended).  
2. **npm** or **yarn** to manage dependencies.
3. A public server or a local environment for testing.  
   - If you have a publicly reachable server (like an EC2 instance), the **relay** is best run there with open ports.  
   - You can still test locally on a single machine or LAN, but NAT traversal might not be fully tested unless you use a public IP.

### Installation Steps

1. **Clone** or **download** this repository.
2. In the repository root, install dependencies:
   ```bash
   npm install
   ```
   This will install all required packages such as `libp2p`, `@chainsafe/libp2p-noise`, `@libp2p/circuit-relay-v2`, and more (as specified in your `package.json`).

### Running the Relay

1. In a terminal, start the **relay**:
   ```bash
   node relay.js
   ```
2. It will print out multiaddresses, such as:
   ```
   /ip4/0.0.0.0/tcp/3001/ws/p2p/12D3KooWGMYMmN1RGUY...
   ```
   If you’re running on a VPS/EC2, you should see your public IP in the addresses.  

> **Note:** If you see something like `/ip4/127.0.0.1/` or `/ip4/192.168.x.x/` on a cloud instance, ensure your AWS security group or firewall is configured to allow inbound traffic on TCP port `3001`.

### Running the Listener

1. **Open a second terminal** (keep the relay running).
2. Run:
   ```bash
   node listener.js
   ```
3. After a few seconds, you should see logs indicating:
   - The listener’s peer ID.
   - It has **circuit addresses** from the relay (`/p2p-circuit/p2p/...`).
   - The console will say `You can share your /p2p-circuit address...`

### Running the Dialer

1. **Open a third terminal** (keep both relay and listener running).
2. In the **`dialer.js`** file, make sure `LISTENER_CIRCUIT_MA` is set to the listener’s circuit address you saw from the console output in the previous step. It should look like:
   ```
   const LISTENER_CIRCUIT_MA = '/ip4/13.60.15.36/tcp/3001/ws/p2p/12D3K.../p2p-circuit/p2p/12D3KooWKEXM...'
   ```
   Update it to match your exact address.
3. Run:
   ```bash
   node dialer.js
   ```
4. You should see:
   - The dialer’s addresses.
   - A successful dial to the listener’s `/node-1` protocol.
   - A prompt allowing you to type messages into the console.

### Exchanging Messages

- In the **dialer** terminal, type a message and press **Enter**.  
  You should see the message in the **listener** terminal.
- In the **listener** terminal, type a reply and press **Enter**.  
  You should see the reply in the **dialer** terminal.

Congratulations! You have established a peer-to-peer connection through the relay, enabling NAT traversal and letting two nodes communicate even if they are behind firewalls or different networks.

---

## Troubleshooting

- **No public IP in the Relay’s addresses**:  
  Make sure your server has a public IP and the correct ports open (3001 TCP in this example).

- **Connection timeouts**:  
  Double-check your firewall or NAT rules. Verify the addresses in `relay.js`, `listener.js`, and `dialer.js`.

- **Incorrect listener circuit address**:  
  Update `LISTENER_CIRCUIT_MA` in `dialer.js` with the actual address the **listener** displays.

- **Dependency issues**:  
  Run `npm install` again or delete `node_modules` and reinstall to fix dependency mismatches.

---

## Contributing

If you’d like to contribute or improve this example:

1. Fork the repository.  
2. Create a feature branch.  
3. Submit a pull request with your changes.  

All contributions and suggestions are welcome!

---

## License

This project is licensed under the [MIT License](./LICENSE) – feel free to modify and use it for your own applications.