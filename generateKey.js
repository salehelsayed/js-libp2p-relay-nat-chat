import { generateKeyPair, privateKeyToProtobuf } from '@libp2p/crypto/keys'

async function main () {
const privateKey = await generateKeyPair('Ed25519')

console.log("privateKey")
console.log(privateKey)

console.log("protobufBytes")
const protobufBytes = privateKeyToProtobuf(privateKey)
console.log(protobufBytes)
}
main()
