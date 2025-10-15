const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClientRegistry", function () {
    let registry;
    let owner, client1, client2;
    
    beforeEach(async function () {
        [owner, client1, client2] = await ethers.getSigners();
        
        const Registry = await ethers.getContractFactory("ClientRegistry");
        const codeHash = ethers.keccak256(ethers.toUtf8Bytes("training_code_v1"));
        registry = await Registry.deploy(codeHash);
    });
    
    it("Should register a client", async function () {
        const tpmKeyHash = ethers.keccak256(ethers.toUtf8Bytes("tpm_key_1"));
        const attestation = ethers.toUtf8Bytes("attestation_data");
        
        await registry.connect(client1).registerClient(tpmKeyHash, attestation);
        
        const clientData = await registry.getClient(client1.address);
        expect(clientData.reputation).to.equal(100);
        expect(clientData.isActive).to.be.true;
    });
    
    it("Should prevent duplicate registration", async function () {
        const tpmKeyHash = ethers.keccak256(ethers.toUtf8Bytes("tpm_key_1"));
        const attestation = ethers.toUtf8Bytes("attestation_data");
        
        await registry.connect(client1).registerClient(tpmKeyHash, attestation);
        
        await expect(
            registry.connect(client1).registerClient(tpmKeyHash, attestation)
        ).to.be.revertedWith("Already registered");
    });
    
    it("Should prevent TPM key reuse", async function () {
        const tpmKeyHash = ethers.keccak256(ethers.toUtf8Bytes("tpm_key_1"));
        const attestation = ethers.toUtf8Bytes("attestation_data");
        
        await registry.connect(client1).registerClient(tpmKeyHash, attestation);
        
        await expect(
            registry.connect(client2).registerClient(tpmKeyHash, attestation)
        ).to.be.revertedWith("TPM key already used");
    });
    
    it("Should update reputation", async function () {
        const tpmKeyHash = ethers.keccak256(ethers.toUtf8Bytes("tpm_key_1"));
        const attestation = ethers.toUtf8Bytes("attestation_data");
        
        await registry.connect(client1).registerClient(tpmKeyHash, attestation);
        
        await registry.updateReputation(client1.address, -20);
        
        const clientData = await registry.getClient(client1.address);
        expect(clientData.reputation).to.equal(80);
    });
});