pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DisputeResolver is ZamaEthereumConfig {
    struct Dispute {
        string encryptedEvidence;
        euint32 encryptedClaim;
        uint256 publicFactor1;
        uint256 publicFactor2;
        address claimant;
        uint256 submissionTime;
        uint32 decryptedRecommendation;
        bool isResolved;
    }

    mapping(string => Dispute) public disputes;
    string[] public disputeIds;

    event DisputeFiled(string indexed disputeId, address indexed claimant);
    event ResolutionVerified(string indexed disputeId, uint32 recommendation);

    constructor() ZamaEthereumConfig() {}

    function fileDispute(
        string calldata disputeId,
        externalEuint32 encryptedClaim,
        bytes calldata claimProof,
        string calldata encryptedEvidence,
        uint256 publicFactor1,
        uint256 publicFactor2
    ) external {
        require(bytes(disputes[disputeId].encryptedEvidence).length == 0, "Dispute already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedClaim, claimProof)), "Invalid encrypted claim");

        disputes[disputeId] = Dispute({
            encryptedEvidence: encryptedEvidence,
            encryptedClaim: FHE.fromExternal(encryptedClaim, claimProof),
            publicFactor1: publicFactor1,
            publicFactor2: publicFactor2,
            claimant: msg.sender,
            submissionTime: block.timestamp,
            decryptedRecommendation: 0,
            isResolved: false
        });

        FHE.allowThis(disputes[disputeId].encryptedClaim);
        FHE.makePubliclyDecryptable(disputes[disputeId].encryptedClaim);
        disputeIds.push(disputeId);

        emit DisputeFiled(disputeId, msg.sender);
    }

    function verifyResolution(
        string calldata disputeId,
        bytes memory abiEncodedRecommendation,
        bytes memory resolutionProof
    ) external {
        require(bytes(disputes[disputeId].encryptedEvidence).length > 0, "Dispute does not exist");
        require(!disputes[disputeId].isResolved, "Dispute already resolved");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(disputes[disputeId].encryptedClaim);

        FHE.checkSignatures(cts, abiEncodedRecommendation, resolutionProof);
        uint32 decodedRecommendation = abi.decode(abiEncodedRecommendation, (uint32));

        disputes[disputeId].decryptedRecommendation = decodedRecommendation;
        disputes[disputeId].isResolved = true;

        emit ResolutionVerified(disputeId, decodedRecommendation);
    }

    function getEncryptedClaim(string calldata disputeId) external view returns (euint32) {
        require(bytes(disputes[disputeId].encryptedEvidence).length > 0, "Dispute does not exist");
        return disputes[disputeId].encryptedClaim;
    }

    function getDisputeDetails(string calldata disputeId) external view returns (
        string memory encryptedEvidence,
        uint256 publicFactor1,
        uint256 publicFactor2,
        address claimant,
        uint256 submissionTime,
        bool isResolved,
        uint32 decryptedRecommendation
    ) {
        require(bytes(disputes[disputeId].encryptedEvidence).length > 0, "Dispute does not exist");
        Dispute storage dispute = disputes[disputeId];

        return (
            dispute.encryptedEvidence,
            dispute.publicFactor1,
            dispute.publicFactor2,
            dispute.claimant,
            dispute.submissionTime,
            dispute.isResolved,
            dispute.decryptedRecommendation
        );
    }

    function getAllDisputeIds() external view returns (string[] memory) {
        return disputeIds;
    }

    function serviceStatus() public pure returns (bool operational) {
        operational = true;
    }
}


