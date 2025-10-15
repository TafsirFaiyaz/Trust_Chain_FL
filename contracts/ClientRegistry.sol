// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ClientRegistry {
    
    struct Client {
        address clientAddress;
        bytes32 tpmPublicKeyHash;     // Hash of TPM public key
        bytes32 approvedCodeHash;      // Hash of approved training code
        uint256 reputation;            // 0-100 score
        uint256 registrationTime;
        uint256 totalRoundsParticipated;
        uint256 successfulRounds;
        bool isActive;
    }
    
    mapping(address => Client) public clients;
    mapping(bytes32 => bool) public usedTPMKeys; // Prevent TPM reuse
    
    address public owner;
    bytes32 public globalApprovedCodeHash;
    uint256 public minReputation = 50;
    
    event ClientRegistered(address indexed client, bytes32 tpmKeyHash);
    event ReputationUpdated(address indexed client, uint256 newReputation);
    event ClientDeactivated(address indexed client, string reason);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }
    
    constructor(bytes32 _approvedCodeHash) {
        owner = msg.sender;
        globalApprovedCodeHash = _approvedCodeHash;
    }
    
    function registerClient(
        bytes32 _tpmPubKeyHash,
        bytes memory _tpmAttestation
    ) external {
        require(clients[msg.sender].clientAddress == address(0), 
                "Already registered");
        require(!usedTPMKeys[_tpmPubKeyHash], 
                "TPM key already used");
        
        // In production: verify TPM attestation here
        // For now: simple check
        require(_tpmAttestation.length > 0, "Invalid attestation");
        
        clients[msg.sender] = Client({
            clientAddress: msg.sender,
            tpmPublicKeyHash: _tpmPubKeyHash,
            approvedCodeHash: globalApprovedCodeHash,
            reputation: 100,  // Start with perfect reputation
            registrationTime: block.timestamp,
            totalRoundsParticipated: 0,
            successfulRounds: 0,
            isActive: true
        });
        
        usedTPMKeys[_tpmPubKeyHash] = true;
        
        emit ClientRegistered(msg.sender, _tpmPubKeyHash);
    }
    
    function updateReputation(
        address _client, 
        int256 _change
    ) external onlyOwner {
        require(clients[_client].isActive, "Client not active");
        
        int256 newRep = int256(clients[_client].reputation) + _change;
        
        // Clamp between 0 and 100
        if (newRep < 0) newRep = 0;
        if (newRep > 100) newRep = 100;
        
        clients[_client].reputation = uint256(newRep);
        
        emit ReputationUpdated(_client, uint256(newRep));
        
        // Auto-deactivate if reputation too low
        if (uint256(newRep) < minReputation) {
            clients[_client].isActive = false;
            emit ClientDeactivated(_client, "Low reputation");
        }
    }
    
    function getClient(address _client) external view returns (Client memory) {
        return clients[_client];
    }
    
    function isClientEligible(address _client) external view returns (bool) {
        Client memory client = clients[_client];
        return client.isActive && client.reputation >= minReputation;
    }
}