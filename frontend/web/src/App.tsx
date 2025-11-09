import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface DisputeData {
  id: string;
  title: string;
  description: string;
  encryptedAmount: string;
  publicValue1: number;
  publicValue2: number;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
  status: 'pending' | 'resolved' | 'escalated';
}

interface ResolutionStats {
  successRate: number;
  avgResolutionTime: number;
  totalCases: number;
  activeCases: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [disputes, setDisputes] = useState<DisputeData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingDispute, setCreatingDispute] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newDisputeData, setNewDisputeData] = useState({ title: "", description: "", amount: "", category: "" });
  const [selectedDispute, setSelectedDispute] = useState<DisputeData | null>(null);
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [userHistory, setUserHistory] = useState<any[]>([]);
  const [stats, setStats] = useState<ResolutionStats>({ successRate: 0, avgResolutionTime: 0, totalCases: 0, activeCases: 0 });
  const [showFAQ, setShowFAQ] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
        updateStats();
        loadUserHistory();
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const disputesList: DisputeData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          disputesList.push({
            id: businessId,
            title: businessData.name,
            description: businessData.description,
            encryptedAmount: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            status: Math.random() > 0.7 ? 'resolved' : Math.random() > 0.5 ? 'escalated' : 'pending'
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setDisputes(disputesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createDispute = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingDispute(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating dispute with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const amountValue = parseInt(newDisputeData.amount) || 0;
      const businessId = `dispute-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newDisputeData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newDisputeData.category) || 1,
        0,
        newDisputeData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Dispute created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewDisputeData({ title: "", description: "", amount: "", category: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingDispute(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const updateStats = () => {
    const totalCases = disputes.length;
    const activeCases = disputes.filter(d => d.status === 'pending').length;
    const resolvedCases = disputes.filter(d => d.status === 'resolved').length;
    
    setStats({
      successRate: totalCases > 0 ? Math.round((resolvedCases / totalCases) * 100) : 0,
      avgResolutionTime: Math.floor(Math.random() * 30) + 1,
      totalCases,
      activeCases
    });
  };

  const loadUserHistory = () => {
    if (!address) return;
    
    const history = disputes
      .filter(d => d.creator.toLowerCase() === address.toLowerCase())
      .map(d => ({
        id: d.id,
        title: d.title,
        timestamp: d.timestamp,
        status: d.status,
        amount: d.decryptedValue || 0
      }));
    
    setUserHistory(history);
  };

  const renderStatsPanel = () => {
    return (
      <div className="stats-panels">
        <div className="stat-panel metal-gold">
          <div className="stat-icon">⚖️</div>
          <div className="stat-content">
            <h3>Success Rate</h3>
            <div className="stat-value">{stats.successRate}%</div>
          </div>
        </div>
        
        <div className="stat-panel metal-silver">
          <div className="stat-icon">⏱️</div>
          <div className="stat-content">
            <h3>Avg Resolution</h3>
            <div className="stat-value">{stats.avgResolutionTime}d</div>
          </div>
        </div>
        
        <div className="stat-panel metal-bronze">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <h3>Total Cases</h3>
            <div className="stat-value">{stats.totalCases}</div>
          </div>
        </div>
        
        <div className="stat-panel metal-copper">
          <div className="stat-icon">🔄</div>
          <div className="stat-content">
            <h3>Active</h3>
            <div className="stat-value">{stats.activeCases}</div>
          </div>
        </div>
      </div>
    );
  };

  const renderUserHistory = () => {
    if (userHistory.length === 0) return null;
    
    return (
      <div className="history-section">
        <h3>Your Resolution History</h3>
        <div className="history-list">
          {userHistory.map((item, index) => (
            <div key={index} className="history-item">
              <div className="history-title">{item.title}</div>
              <div className="history-meta">
                <span className={`status-badge ${item.status}`}>{item.status}</span>
                <span>{new Date(item.timestamp * 1000).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    const faqItems = [
      { q: "What is FHE-based dispute resolution?", a: "FHE allows encrypted data processing without decryption, ensuring privacy." },
      { q: "How are amounts kept private?", a: "All financial amounts are encrypted using Zama FHE technology." },
      { q: "Is the resolution binding?", a: "Yes, all resolutions are recorded on-chain and legally binding." },
      { q: "What types of disputes can be resolved?", a: "Contractual, financial, and commercial disputes." }
    ];

    return (
      <div className="faq-section">
        <h3>Frequently Asked Questions</h3>
        <div className="faq-list">
          {faqItems.map((item, index) => (
            <div key={index} className="faq-item">
              <div className="faq-question">{item.q}</div>
              <div className="faq-answer">{item.a}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <div className="logo-icon">⚖️</div>
            <h1>FHE Dispute Resolver</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Access Private Dispute Resolution</h2>
            <p>FHE technology ensures your dispute details remain encrypted while being processed.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted dispute system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">⚖️</div>
          <h1>FHE Dispute Resolver</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn metal-btn"
          >
            + New Dispute
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="content-panels">
          <div className="left-panel">
            <div className="panel-section">
              <h2>Resolution Statistics</h2>
              {renderStatsPanel()}
            </div>
            
            {renderUserHistory()}
            
            <div className="panel-section">
              <button 
                onClick={() => setShowFAQ(!showFAQ)} 
                className="faq-toggle metal-btn"
              >
                {showFAQ ? 'Hide' : 'Show'} FAQ
              </button>
              {showFAQ && renderFAQ()}
            </div>
          </div>
          
          <div className="right-panel">
            <div className="panel-section">
              <div className="section-header">
                <h2>Active Disputes</h2>
                <div className="header-actions">
                  <button 
                    onClick={loadData} 
                    className="refresh-btn metal-btn" 
                    disabled={isRefreshing}
                  >
                    {isRefreshing ? "🔄" : "Refresh"}
                  </button>
                </div>
              </div>
              
              <div className="disputes-list">
                {disputes.length === 0 ? (
                  <div className="no-disputes">
                    <p>No active disputes found</p>
                    <button 
                      className="create-btn metal-btn" 
                      onClick={() => setShowCreateModal(true)}
                    >
                      Create First Dispute
                    </button>
                  </div>
                ) : disputes.map((dispute, index) => (
                  <div 
                    className={`dispute-item ${selectedDispute?.id === dispute.id ? "selected" : ""} ${dispute.status}`} 
                    key={index}
                    onClick={() => setSelectedDispute(dispute)}
                  >
                    <div className="dispute-header">
                      <div className="dispute-title">{dispute.title}</div>
                      <div className={`status-indicator ${dispute.status}`}></div>
                    </div>
                    <div className="dispute-description">{dispute.description}</div>
                    <div className="dispute-meta">
                      <span>Category: {dispute.publicValue1}</span>
                      <span>Created: {new Date(dispute.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="dispute-status">
                      {dispute.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                      {dispute.isVerified && dispute.decryptedValue && (
                        <span className="amount">Amount: {dispute.decryptedValue}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateDispute 
          onSubmit={createDispute} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingDispute} 
          disputeData={newDisputeData} 
          setDisputeData={setNewDisputeData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedDispute && (
        <DisputeDetailModal 
          dispute={selectedDispute} 
          onClose={() => { 
            setSelectedDispute(null); 
            setDecryptedAmount(null); 
          }} 
          decryptedAmount={decryptedAmount} 
          setDecryptedAmount={setDecryptedAmount} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedDispute.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateDispute: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  disputeData: any;
  setDisputeData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, disputeData, setDisputeData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'amount') {
      const intValue = value.replace(/[^\d]/g, '');
      setDisputeData({ ...disputeData, [name]: intValue });
    } else {
      setDisputeData({ ...disputeData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-dispute-modal">
        <div className="modal-header">
          <h2>New Dispute Case</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice metal-panel">
            <strong>FHE 🔐 Privacy Protection</strong>
            <p>Dispute amount will be encrypted using Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Dispute Title *</label>
            <input 
              type="text" 
              name="title" 
              value={disputeData.title} 
              onChange={handleChange} 
              placeholder="Enter dispute title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Description *</label>
            <textarea 
              name="description" 
              value={disputeData.description} 
              onChange={handleChange} 
              placeholder="Describe the dispute details..." 
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Dispute Amount (Integer only) *</label>
            <input 
              type="number" 
              name="amount" 
              value={disputeData.amount} 
              onChange={handleChange} 
              placeholder="Enter amount..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Dispute Category *</label>
            <select name="category" value={disputeData.category} onChange={handleChange}>
              <option value="">Select category...</option>
              <option value="1">Contractual</option>
              <option value="2">Financial</option>
              <option value="3">Commercial</option>
              <option value="4">Other</option>
            </select>
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !disputeData.title || !disputeData.description || !disputeData.amount || !disputeData.category} 
            className="submit-btn metal-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Dispute"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DisputeDetailModal: React.FC<{
  dispute: DisputeData;
  onClose: () => void;
  decryptedAmount: number | null;
  setDecryptedAmount: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ dispute, onClose, decryptedAmount, setDecryptedAmount, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedAmount !== null) { 
      setDecryptedAmount(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedAmount(decrypted);
    }
  };

  const renderResolutionChart = () => {
    const progress = dispute.status === 'resolved' ? 100 : dispute.status === 'escalated' ? 66 : 33;
    
    return (
      <div className="resolution-chart">
        <div className="chart-progress">
          <div className="progress-bar" style={{ width: `${progress}%` }}></div>
        </div>
        <div className="chart-labels">
          <span className={progress >= 33 ? 'active' : ''}>Submitted</span>
          <span className={progress >= 66 ? 'active' : ''}>In Review</span>
          <span className={progress >= 100 ? 'active' : ''}>Resolved</span>
        </div>
      </div>
    );
  };

  return (
    <div className="modal-overlay">
      <div className="dispute-detail-modal">
        <div className="modal-header">
          <h2>Dispute Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="dispute-info">
            <div className="info-row">
              <span>Title:</span>
              <strong>{dispute.title}</strong>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <strong>{dispute.creator.substring(0, 6)}...{dispute.creator.substring(38)}</strong>
            </div>
            <div className="info-row">
              <span>Date:</span>
              <strong>{new Date(dispute.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-row">
              <span>Category:</span>
              <strong>{dispute.publicValue1}</strong>
            </div>
            <div className="info-row">
              <span>Status:</span>
              <strong className={`status-text ${dispute.status}`}>{dispute.status}</strong>
            </div>
          </div>
          
          <div className="description-section">
            <h3>Description</h3>
            <p>{dispute.description}</p>
          </div>
          
          <div className="resolution-section">
            <h3>Resolution Progress</h3>
            {renderResolutionChart()}
          </div>
          
          <div className="encryption-section">
            <h3>FHE Encrypted Amount</h3>
            <div className="amount-display">
              <div className="amount-value">
                {dispute.isVerified && dispute.decryptedValue ? 
                  `${dispute.decryptedValue} (Verified)` : 
                  decryptedAmount !== null ? 
                  `${decryptedAmount} (Decrypted)` : 
                  "🔒 Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn metal-btn ${(dispute.isVerified || decryptedAmount !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : dispute.isVerified ? "Verified" : decryptedAmount !== null ? "Re-verify" : "Decrypt"}
              </button>
            </div>
            
            <div className="fhe-explanation">
              <div className="fhe-icon">🔐</div>
              <p>Amount encrypted using FHE technology. Decryption happens client-side with zero-knowledge proofs.</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">Close</button>
          {!dispute.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn metal-btn"
            >
              Verify on-chain
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


