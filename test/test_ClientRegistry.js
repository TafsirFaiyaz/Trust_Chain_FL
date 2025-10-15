// test/test_ClientRegistry.js
// test/test_ClientRegistry.js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";
import { keccak256, stringToBytes, toHex, zeroAddress } from "viem";


describe("ClientRegistry (Viem + node:assert)", function () {
  let registry;
  let ownerWC, client1WC, client2WC, client3WC; // wallet clients
  let owner, client1, client2, client3;        // addresses
  let approvedCodeHash;

  beforeEach(async function () {
    // Get wallet & public clients from Hardhat's Viem toolbox
    const wallets = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();

    [ownerWC, client1WC, client2WC, client3WC] = wallets;
    owner   = ownerWC.account.address;
    client1 = client1WC.account.address;
    client2 = client2WC.account.address;
    client3 = client3WC.account.address;

    // Compute approved code hash (bytes32)
    approvedCodeHash = keccak256(stringToBytes("training_code_v1"));

    // Deploy contract with the owner wallet client
    registry = await hre.viem.deployContract("ClientRegistry", [approvedCodeHash], {
      client: ownerWC,
    });

    // Quick sanity: contract address exists
    assert.ok(registry.address && registry.address.startsWith("0x"));
  });

  describe("Deployment", function () {
    it("sets the correct owner", async function () {
      const val = await registry.read.owner();
      assert.equal(val, owner);
    });

    it("sets the correct global approved code hash", async function () {
      const val = await registry.read.globalApprovedCodeHash();
      assert.equal(val, approvedCodeHash);
    });

    it("sets minimum reputation to 50", async function () {
      const val = await registry.read.minReputation();
      assert.equal(Number(val), 50);
    });
  });

  describe("Client Registration", function () {
    it("registers a client successfully", async function () {
      const tpmKeyHash  = keccak256(stringToBytes("tpm_key_1"));
      const attestation = toHex(stringToBytes("attestation_data")); // bytes

      // Write call as client1
      await registry.write.registerClient([tpmKeyHash, attestation], { account: client1 });

      const data = await registry.read.getClient([client1]);
      // data is a struct; viem returns an object with named fields
      assert.equal(data.clientAddress, client1);
      assert.equal(data.tpmPublicKeyHash, tpmKeyHash);
      assert.equal(data.approvedCodeHash, approvedCodeHash);
      assert.equal(Number(data.reputation), 100);
      assert.equal(data.isActive, true);
      assert.equal(Number(data.totalRoundsParticipated), 0);
      assert.equal(Number(data.successfulRounds), 0);
    });

    it("prevents duplicate registration", async function () {
      const tpmKeyHash  = keccak256(stringToBytes("tpm_key_1"));
      const attestation = toHex(stringToBytes("attestation_data"));

      await registry.write.registerClient([tpmKeyHash, attestation], { account: client1 });

      // Expect revert: "Already registered"
      await assert.rejects(
        registry.write.registerClient([tpmKeyHash, attestation], { account: client1 }),
        /Already registered/
      );
    });

    it("prevents TPM key reuse", async function () {
      const tpmKeyHash  = keccak256(stringToBytes("tpm_key_1"));
      const attestation = toHex(stringToBytes("attestation_data"));

      await registry.write.registerClient([tpmKeyHash, attestation], { account: client1 });

      await assert.rejects(
        registry.write.registerClient([tpmKeyHash, attestation], { account: client2 }),
        /TPM key already used/
      );
    });

    it("rejects empty attestation", async function () {
      const tpmKeyHash        = keccak256(stringToBytes("tpm_key_1"));
      const emptyAttestation  = "0x";

      await assert.rejects(
        registry.write.registerClient([tpmKeyHash, emptyAttestation], { account: client1 }),
        /Invalid attestation/
      );
    });

    it("allows multiple clients with different TPM keys", async function () {
      const tpmKeyHash1 = keccak256(stringToBytes("tpm_key_1"));
      const tpmKeyHash2 = keccak256(stringToBytes("tpm_key_2"));
      const attestation = toHex(stringToBytes("attestation_data"));

      await registry.write.registerClient([tpmKeyHash1, attestation], { account: client1 });
      await registry.write.registerClient([tpmKeyHash2, attestation], { account: client2 });

      const c1 = await registry.read.getClient([client1]);
      const c2 = await registry.read.getClient([client2]);

      assert.equal(c1.isActive, true);
      assert.equal(c2.isActive, true);
      assert.notEqual(c1.tpmPublicKeyHash, c2.tpmPublicKeyHash);
    });
  });

  describe("Reputation Management", function () {
    beforeEach(async function () {
      const tpmKeyHash  = keccak256(stringToBytes("tpm_key_1"));
      const attestation = toHex(stringToBytes("attestation_data"));
      await registry.write.registerClient([tpmKeyHash, attestation], { account: client1 });
    });

    it("updates reputation correctly (decrease)", async function () {
      await registry.write.updateReputation([client1, -20n], { account: owner });
      const d = await registry.read.getClient([client1]);
      assert.equal(Number(d.reputation), 80);
    });

    it("updates reputation correctly (increase after decrease)", async function () {
      await registry.write.updateReputation([client1, -30n], { account: owner });
      await registry.write.updateReputation([client1, 10n],  { account: owner });
      const d = await registry.read.getClient([client1]);
      assert.equal(Number(d.reputation), 80);
    });

    it("clamps reputation at 0 (min)", async function () {
      await registry.write.updateReputation([client1, -150n], { account: owner });
      const d = await registry.read.getClient([client1]);
      assert.equal(Number(d.reputation), 0);
    });

    it("clamps reputation at 100 (max)", async function () {
      await registry.write.updateReputation([client1, 50n], { account: owner });
      const d = await registry.read.getClient([client1]);
      assert.equal(Number(d.reputation), 100);
    });

    it("deactivates client when reputation drops below minimum", async function () {
      await registry.write.updateReputation([client1, -51n], { account: owner });
      const d = await registry.read.getClient([client1]);
      assert.equal(Number(d.reputation), 49);
      assert.equal(d.isActive, false);
    });

    it("only owner can update reputation", async function () {
      await assert.rejects(
        registry.write.updateReputation([client1, -10n], { account: client2 }),
        /Only owner/
      );
    });

    it("won't update reputation for inactive client", async function () {
      await registry.write.updateReputation([client1, -51n], { account: owner });
      await assert.rejects(
        registry.write.updateReputation([client1, 10n], { account: owner }),
        /Client not active/
      );
    });

    it("won't update reputation for unregistered client", async function () {
      await assert.rejects(
        registry.write.updateReputation([client2, 10n], { account: owner }),
        /Client not active/
      );
    });
  });

  describe("Client Eligibility", function () {
    beforeEach(async function () {
      const tpmKeyHash  = keccak256(stringToBytes("tpm_key_1"));
      const attestation = toHex(stringToBytes("attestation_data"));
      await registry.write.registerClient([tpmKeyHash, attestation], { account: client1 });
    });

    it("returns true for eligible client", async function () {
      const ok = await registry.read.isClientEligible([client1]);
      assert.equal(ok, true);
    });

    it("returns false for unregistered client", async function () {
      const ok = await registry.read.isClientEligible([client2]);
      assert.equal(ok, false);
    });

    it("returns false when reputation is below minimum", async function () {
      await registry.write.updateReputation([client1, -51n], { account: owner });
      const ok = await registry.read.isClientEligible([client1]);
      assert.equal(ok, false);
    });

    it("returns false when client is inactive", async function () {
      await registry.write.updateReputation([client1, -51n], { account: owner });
      const d = await registry.read.getClient([client1]);
      assert.equal(d.isActive, false);
      const ok = await registry.read.isClientEligible([client1]);
      assert.equal(ok, false);
    });

    it("returns true when reputation is exactly at minimum", async function () {
      await registry.write.updateReputation([client1, -50n], { account: owner });
      const d  = await registry.read.getClient([client1]);
      assert.equal(Number(d.reputation), 50);
      const ok = await registry.read.isClientEligible([client1]);
      assert.equal(ok, true);
    });
  });

  describe("Edge Cases", function () {
    it("handles zero reputation change", async function () {
      const tpmKeyHash  = keccak256(stringToBytes("tpm_key_1"));
      const attestation = toHex(stringToBytes("attestation_data"));
      await registry.write.registerClient([tpmKeyHash, attestation], { account: client1 });
      await registry.write.updateReputation([client1, 0n], { account: owner });
      const d = await registry.read.getClient([client1]);
      assert.equal(Number(d.reputation), 100);
    });

    it("handles multiple reputation updates", async function () {
      const tpmKeyHash  = keccak256(stringToBytes("tpm_key_1"));
      const attestation = toHex(stringToBytes("attestation_data"));
      await registry.write.registerClient([tpmKeyHash, attestation], { account: client1 });

      await registry.write.updateReputation([client1, -10n], { account: owner });
      await registry.write.updateReputation([client1, -15n], { account: owner });
      await registry.write.updateReputation([client1, 5n],   { account: owner });

      const d = await registry.read.getClient([client1]);
      assert.equal(Number(d.reputation), 80);
    });

    it("returns empty client data for unregistered address", async function () {
      const d = await registry.read.getClient([client2]);
      assert.equal(d.clientAddress, zeroAddress);
      assert.equal(Number(d.reputation), 0);
      assert.equal(d.isActive, false);
    });
  });

  describe("Gas-ish batch", function () {
    it("efficiently registers multiple clients", async function () {
      const clients = [client1, client2, client3];
      for (let i = 0; i < clients.length; i++) {
        const tpmKeyHash  = keccak256(stringToBytes(`tpm_key_${i}`));
        const attestation = toHex(stringToBytes("attestation_data"));
        await registry.write.registerClient([tpmKeyHash, attestation], { account: clients[i] });
      }

      for (let i = 0; i < clients.length; i++) {
        const d = await registry.read.getClient([clients[i]]);
        assert.equal(d.isActive, true);
        assert.equal(Number(d.reputation), 100);
      }
    });
  });
});
