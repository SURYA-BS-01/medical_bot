import { useState, useEffect, useRef } from 'react';
import { FiSend, FiRefreshCw, FiFileText, FiPlus, FiMessageCircle, FiClock, FiCheckCircle, FiAlertCircle } from 'react-icons/fi';
import { MdMedicalServices, MdOutlineHistory, MdOutlineHealthAndSafety } from 'react-icons/md';
import { BsArrowRightCircle, BsExclamationTriangle } from 'react-icons/bs';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

const diagnosisStyles = `
  /* Add new styles for the diagnosis card */
  .diagnosis-card {
    background-color: #f0f9ff;
    border: 1px solid #bae6fd;
    border-radius: 0.5rem;
    padding: 1rem;
    margin-bottom: 0.5rem;
  }
  
  .diagnosis-header {
    color: #0369a1;
    font-size: 1rem;
    font-weight: 700;
    margin-top: 0.75rem;
    margin-bottom: 0.5rem;
    border-bottom: 1px solid #bae6fd;
    padding-bottom: 0.25rem;
  }
  
  .diagnosis-content {
    color: #1e3a8a;
    font-weight: 500;
    margin-bottom: 0.75rem;
  }
  
  .diagnosis-list {
    list-style-type: disc;
    padding-left: 1.5rem;
    margin-bottom: 0.75rem;
  }
  
  .diagnosis-list li {
    color: #0284c7;
    margin-bottom: 0.375rem;
    font-weight: 500;
  }
  
  .diagnosis-note {
    font-size: 0.9rem;
    color: #475569;
    font-style: italic;
  }
  
  /* Updated urgent message styling */
  .urgent-message {
    background-color: #fef2f2;
    border: 1px solid #f87171;
    border-radius: 0.5rem;
    padding: 0.75rem;
    margin-bottom: 0.5rem;
  }
  
  .urgent-header {
    color: #dc2626;
    font-size: 1.1rem;
    font-weight: bold;
    margin-bottom: 0.75rem;
    text-align: center;
  }
  
  .urgent-content {
    color: #b91c1c;
    margin-bottom: 0.75rem;
  }
  
  .urgent-content p {
    margin-bottom: 0.5rem;
    display: block;
  }
  
  .urgent-content p strong {
    display: inline-block;
    min-width: 1.5rem;
  }
  
  .urgent-footer {
    font-size: 0.9rem;
    font-weight: bold;
    color: #dc2626;
    margin-top: 0.5rem;
    text-align: center;
  }
`;

const ChatPage = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [userId, setUserId] = useState(`user-${Math.random().toString(36).substr(2, 9)}`);
  const [currentStep, setCurrentStep] = useState('start');
  const [patientData, setPatientData] = useState({
    symptoms: [],
    previous_history: "",
    medication_history: "",
    additional_symptoms: "",
    diagnosis: "",
    critical: false
  });
  const [conversationComplete, setConversationComplete] = useState(false);
  const [showSummaryButton, setShowSummaryButton] = useState(false);
  const [messageCount, setMessageCount] = useState(0);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // If we have a user from auth context, use their ID
    if (user && user.user_id) {
      setUserId(user.user_id);
      // Fetch chat history for this user
      fetchChatHistory(user.user_id);
    } else {
      // Try to restore user from localStorage before redirecting
      const storedUser = localStorage.getItem('medbot_user');
      const storedToken = localStorage.getItem('medbot_token');
      
      if (storedUser && storedToken) {
        // Parse the stored user data
        try {
          const parsedUser = JSON.parse(storedUser);
          if (parsedUser && parsedUser.user_id) {
            // Set the user ID for this component
            setUserId(parsedUser.user_id);
            // Fetch chat history for this user
            fetchChatHistory(parsedUser.user_id);
            return; // Don't redirect, we've restored the user
          }
        } catch (e) {
          console.error("Error parsing stored user data:", e);
        }
      }
      
      // No authenticated user or failed to restore from localStorage, redirect to login
      navigate('/login');
    }
  }, [user, navigate]);

  useEffect(() => {
    // Add initial welcome message only once when component mounts
    setMessages([{
      role: 'assistant',
      content: 'Hello! I am your medical assistant. How can I help you today?'
    }]);
    
    // Ensure message count is reset to 0 when component mounts
    setMessageCount(0);
    
    // Don't immediately send a backend request here - wait for user input
  }, []);

  useEffect(() => {
    const testBackendConnection = async () => {
      try {
        // Make a simple request to test connectivity
        const testResponse = await fetch('https://medbot-bknd.onrender.com/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user_id: `test-${Date.now()}`,
            response: 'test message'
          }),
        });
        
        const testData = await testResponse.json();
        console.log('Backend connection test:', testData);
        
        if (testResponse.ok) {
          console.log('Backend connection successful');
        } else {
          console.error('Backend connection failed:', testData);
        }
      } catch (error) {
        console.error('Backend connection error:', error);
      }
    };
    
    // testBackendConnection();
  }, []);

  useEffect(() => {
    // Check if we've reached recommendations based on message content OR step name
    const hasRecommendations = hasReachedRecommendations();
    
    if (
      currentStep === "end" || 
      currentStep === "criticality" || 
      currentStep === "criticality_node" ||
      hasRecommendations
    ) {
      setShowSummaryButton(true);
      
      // Explicitly set conversation complete to true
      setConversationComplete(true);
      
      // Fetch user data to update the sidebar
      fetchUserData();
    }
  }, [currentStep, messages]);

  useEffect(() => {
    // Check if the latest message contains recommendation indicators
    const hasRecommendations = hasReachedRecommendations();
    
    if (hasRecommendations && !conversationComplete) {
      console.log("Recommendations detected, marking consultation as complete");
      setConversationComplete(true);
      setShowSummaryButton(true);
    }
  }, [messages, conversationComplete]);

  useEffect(() => {
    // Check if the latest message contains any of the auto-continue phrases
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      const autoTriggerPhrases = [
        "I'll now analyze your symptoms",
        "analyze all your symptoms and provide a preliminary diagnosis",
        "Thank you for sharing these additional symptoms"
      ];
      
      // Check if any of the trigger phrases are in the message
      const shouldAutoContinue = autoTriggerPhrases.some(phrase => 
        lastMessage.content.includes(phrase)
      );
      
      if (shouldAutoContinue) {
        // Automatically send a continuation request after a short delay
        setTimeout(() => {
          handleContinuation();
        }, 1500); // 1.5 second delay for natural feel
      }
    }
  }, [messages]);

  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = diagnosisStyles;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  useEffect(() => {
    // Check if we've reached 5 exchanges (user + assistant = 1 exchange)
    // Initial welcome message doesn't count, so we check for > 10 total messages
    if (messageCount >= 5 && !conversationComplete && currentStep !== 'start') {
      console.log("Reached message exchange limit, triggering forced diagnosis");
      requestDiagnosis();
    }
  }, [messageCount, conversationComplete]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = { role: 'user', content: input };
    
    // Add the user message to the chat (only once)
    setMessages(prev => [...prev, userMessage]);
    
    // Save original input before clearing
    const currentInput = input;
    setInput('');

    try {
      console.log('Sending request with:', {
        user_id: userId,
        response: currentInput
      });

      // Add loading message
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '...',
        isLoading: true
      }]);

      // For the first message in a completely new conversation, make sure we reset the step
      const isFirstMessage = currentStep === 'start' && messageCount === 0;
      
      // Use fetchWithAuth instead of fetch
      const response = await fetchWithAuth('https://medbot-bknd.onrender.com/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          response: currentInput,
          new_conversation: isFirstMessage, // Tell backend this is a fresh conversation
          reset_context: isFirstMessage, // Additional flag to force context reset
          ignore_previous: true // Ignore any previous conversation context for safer handling
        }),
      });

      // Remove loading message
      setMessages(prev => prev.filter(msg => !msg.isLoading));

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Server error:', errorData);
        
        // If unauthorized, redirect to login
        if (response.status === 401) {
          localStorage.removeItem('medbot_token');
          localStorage.removeItem('medbot_user');
          navigate('/login');
          throw new Error('Session expired. Please login again.');
        }

        // Check if it's the known AIMessage error
        if (errorData.detail && errorData.detail.includes("AIMessage' object has no attribute 'strip")) {
          // Fall back to getting a diagnosis directly
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: "I'm having trouble processing your input. Let me try to provide a diagnosis based on what I know so far."
          }]);
          
          // Try to force a diagnosis after a short delay
          setTimeout(() => {
            requestDiagnosis();
          }, 1500);
          
          return;
        }
        
        throw new Error(errorData.detail || `Server error: ${response.status}`);
      }

      const data = await response.json();
      console.log('Received response:', data);

      if (!data.next_question) {
        throw new Error('Invalid response format from server');
      }

      // Add the bot's response directly
      const botMessage = { role: 'assistant', content: data.next_question };
      setMessages(prev => [...prev, botMessage]);
      
      // Increment message exchange counter
      setMessageCount(prev => prev + 1);
      
      // Update current step
      if (data.current_step) {
        setCurrentStep(data.current_step);
        
        if (data.current_step === "criticality" || data.current_step === "criticality_node") {
          setConversationComplete(true);
          setShowSummaryButton(true);
          // Fetch user data to update the sidebar
          fetchUserData();
        }
      }
      
      // Update chat history
      updateChatHistory(currentInput, data.next_question);
      
    } catch (error) {
      console.error('Error details:', error);
      // Remove loading message if it exists
      setMessages(prev => prev.filter(msg => !msg.isLoading));
      
      // Add error message with fallback option
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.message}. Let's try to get a diagnosis based on what we know so far.`
      }]);
      
      // Show the diagnosis button to help the user continue
      if (currentStep !== 'start') {
        setShowSummaryButton(true);
      }
    }
  };
  
  const updateChatHistory = (userMessage, botResponse) => {
    // Instead of updating the UI state for every message, 
    // we'll only save this to the backend but not show it in the sidebar
    
    // Create a new history entry with title based on first few words of user message
    const title = userMessage.length > 20 
      ? userMessage.substring(0, 20) + '...' 
      : userMessage;
      
    const newEntry = {
      id: Date.now(),
      title: title,
      messages: [
        { role: 'user', content: userMessage },
        { role: 'assistant', content: botResponse }
      ]
    };
    
    // Don't update the chat history UI for regular conversations
    // Only backend storage
    saveChatHistoryToBackend(newEntry);
  };
  
  const fetchUserData = async () => {
    try {
      const response = await fetchWithAuth(`https://medbot-bknd.onrender.com/user/${userId}`);
      if (response.ok) {
        const data = await response.json();
        console.log('User data:', data);
        
        setPatientData({
          symptoms: data.symptoms || [],
          previous_history: data.previous_history || "",
          medication_history: data.medication_history || "",
          additional_symptoms: data.additional_symptoms || "",
          diagnosis: data.diagnosis || "",
          critical: data.critical || false
        });
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    }
  };
  
  const startNewConsultation = () => {
    // Reset all state related to the conversation with a completely fresh state
    setMessages([{
      role: 'assistant',
      content: 'Hello! I am your medical assistant. How can I help you today?'
    }]);
    
    setPatientData({
      symptoms: [],
      previous_history: "",
      medication_history: "",
      additional_symptoms: "",
      diagnosis: "",
      critical: false
    });
    
    // Make sure we're truly starting from the beginning
    setCurrentStep('start');
    setConversationComplete(false);
    setShowSummaryButton(false);
    setMessageCount(0); // Reset message counter
    
    // Create a fresh user ID to completely isolate this conversation
    // This is a more aggressive approach but ensures a clean slate
    const newSessionId = `user-${user.user_id}-session-${Date.now()}`;
    setUserId(newSessionId);
    
    // Reset backend state
    const resetBackendState = async () => {
      try {
        // Request complete reset from backend
        const response = await fetchWithAuth('https://medbot-bknd.onrender.com/force_diagnosis', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            user_id: newSessionId, // Use the new session ID
            reset: true,
            complete_reset: true
          }),
        });
        
        if (!response.ok) {
          console.error('Failed to reset backend state');
        } else {
          console.log('Successfully reset backend state for new consultation');
        }
      } catch (error) {
        console.error('Error resetting backend state:', error);
      }
    };
    
    resetBackendState();
  };

  // Current step indicator with icons
  const getStepInfo = () => {
    const stepInfo = {
      "start": { name: "Welcome", icon: <FiMessageCircle /> },
      "symptoms": { name: "Collecting Symptoms", icon: <MdOutlineHealthAndSafety /> },
      "previous_history": { name: "Medical History", icon: <MdOutlineHistory /> },
      "medication_history": { name: "Medication History", icon: <MdMedicalServices /> },
      "additional_symptoms": { name: "Additional Symptoms", icon: <MdOutlineHealthAndSafety /> },
      "diagnosis": { name: "Diagnosis", icon: <FiCheckCircle /> },
      "diagnosis_prep": { name: "Diagnosis", icon: <FiCheckCircle /> },
      "diagnosis_node": { name: "Diagnosis", icon: <FiCheckCircle /> },
      "criticality": { name: "Recommendations", icon: <FiAlertCircle /> },
      "criticality_node": { name: "Recommendations", icon: <FiAlertCircle /> },
      "end": { name: "Consultation Complete", icon: <FiCheckCircle /> }
    };
    
    // If conversation is complete, show "Consultation Complete" regardless of the current step
    if (conversationComplete) {
      return { name: "Consultation Complete", icon: <FiCheckCircle /> };
    }
    
    return stepInfo[currentStep] || { name: "Consultation", icon: <FiMessageCircle /> };
  };

  // Update the generateCaseSummary function to save the summary to chat history
  const generateCaseSummary = async () => {
    try {
      // Add loading message
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Generating medical case summary...',
        isLoading: true
      }]);

      // Make a special request to generate the summary
      const response = await fetchWithAuth('https://medbot-bknd.onrender.com/generate_summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId
        }),
      });

      // Remove loading message
      setMessages(prev => prev.filter(msg => !msg.isLoading));

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      
      // Format the summary with HTML for better presentation
      const formattedSummary = formatDoctorSummary(data.summary);
      
      // Add the formatted summary to the chat
      const summaryMessage = { role: 'assistant', content: formattedSummary };
      setMessages(prev => [...prev, summaryMessage]);
      
      // Update conversation state
      setConversationComplete(true);
      setShowSummaryButton(false);
      
      // Save the summary to chat history with a special title
      saveSummaryToHistory("Doctor Summary", formattedSummary);
      
    } catch (error) {
      console.error('Error generating summary:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I encountered an error generating the summary: ${error.message}`
      }]);
    }
  };

  // New function to save summaries and recommendations to chat history
  const saveSummaryToHistory = (title, content) => {
    const newEntry = {
      id: Date.now(),
      title: title,
      type: "summary", // Mark as a special entry type
      messages: [
        { role: 'assistant', content: content }
      ],
      timestamp: new Date().toISOString()
    };
    
    // Update the UI chat history with this summary
    setChatHistory(prev => [newEntry, ...prev]);
    
    // Also save to MongoDB via the backend
    saveChatHistoryToBackend(newEntry);
  };
  
  // Function to save chat history to backend
  const saveChatHistoryToBackend = async (historyEntry) => {
    try {
      const response = await fetchWithAuth('https://medbot-bknd.onrender.com/save_chat_history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          history_entry: historyEntry
        }),
      });
      
      if (!response.ok) {
        console.error('Failed to save chat history to backend');
      }
    } catch (error) {
      console.error('Error saving chat history:', error);
    }
  };

  // Fix the formatDoctorSummary function to eliminate duplicate headers
  const formatDoctorSummary = (summaryText) => {
    // Check if the summary is already in HTML format
    if (summaryText.includes("<div") || summaryText.includes("<h")) {
      return summaryText; // Already formatted
    }
    
    // Define sections we want to identify and format
    const sections = [
      "Medical Case Summary",
      "Chief Complaint", 
      "History", 
      "Medications", 
      "Assessment", 
      "Diagnosis",
      "Likely Condition",
      "Recommendations"
    ];

    let formattedHTML = `<div class="diagnosis-card">`;
    // Add ONLY ONE title at the top
    formattedHTML += `<h3 class="diagnosis-header text-center">MEDICAL CASE SUMMARY</h3>`;
    
    // Remove duplicate "Medical Case Summary" titles from the original text
    const cleanedText = summaryText.replace(/##?\s*Medical Case Summary\s*##?/gi, "")
                                   .replace(/\*\*\s*Medical Case Summary\s*\*\*/gi, "");
    
    // Process the text by splitting into sections
    let currentSection = "";
    // Use the cleaned text without duplicate headers
    const lines = cleanedText.split('\n').filter(line => line.trim() !== '');
    
    // Track if we've seen a section to avoid empty sections
    let hasAddedSection = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines and lines that just contain "Medical Case Summary"
      if (line === "" || line.match(/^medical case summary$/i)) {
        continue;
      }
      
      // Check if this line is a section header
      const isSectionHeader = sections.some(section => 
        line.toLowerCase().includes(section.toLowerCase()) && 
        (line.startsWith('**') || line.startsWith('##') || line.startsWith('#'))
      );
      
      if (isSectionHeader) {
        // Close previous section if there was one
        if (currentSection && hasAddedSection) {
          formattedHTML += `</div>`;
        }
        
        // Extract the section name
        let sectionName = line.replace(/\*\*/g, '').replace(/##?/g, '').trim();
        if (sectionName.includes(":")) {
          sectionName = sectionName.split(":")[0].trim();
        }
        
        // Skip "Medical Case Summary" sections since we already added the title
        if (sectionName.toLowerCase() === "medical case summary") {
          continue;
        }
        
        // Start a new section
        currentSection = sectionName;
        formattedHTML += `<div class="diagnosis-content">`;
        formattedHTML += `<h4 class="diagnosis-header">${sectionName.toUpperCase()}</h4>`;
        hasAddedSection = true;
        
        // Special handling for Assessment/Diagnosis section to make it bold
        if (sectionName.includes("Assessment") || sectionName.includes("Diagnosis") || sectionName.includes("Likely Condition")) {
          // Look ahead to get the diagnosis text
          let diagnosisText = "";
          for (let j = i + 1; j < lines.length && !sections.some(s => lines[j].includes(s) && (lines[j].startsWith('**') || lines[j].startsWith('##') || lines[j].startsWith('#'))); j++) {
            diagnosisText += lines[j].trim() + " ";
          }
          
          // Add the bold diagnosis
          formattedHTML += `<p><strong>${diagnosisText.trim()}</strong></p>`;
          
          // Skip the lines we just processed
          while (i + 1 < lines.length && !sections.some(s => lines[i + 1].includes(s) && (lines[i + 1].startsWith('**') || lines[i + 1].startsWith('##') || lines[i + 1].startsWith('#')))) {
            i++;
          }
          
          continue; // Move to the next section
        }
      } else if (line.startsWith('-') || line.startsWith('*')) {
        // This is a bullet point
        if (!formattedHTML.includes("<ul class=\"diagnosis-list\">")) {
          formattedHTML += `<ul class="diagnosis-list">`;
        }
        formattedHTML += `<li>${line.substring(1).trim()}</li>`;
        
        // Check if next line is not a bullet point, close the list
        if (i + 1 >= lines.length || (!lines[i + 1].startsWith('-') && !lines[i + 1].startsWith('*'))) {
          formattedHTML += `</ul>`;
        }
      } else if (currentSection) {
        // Regular text within a section
        // Check for bullet-like text without actual bullets
        if (line.match(/^\d+\.\s/) || line.includes(": ")) {
          // Convert numbered points or key-value pairs to bullet points
          if (!formattedHTML.includes("<ul class=\"diagnosis-list\">")) {
            formattedHTML += `<ul class="diagnosis-list">`;
          }
          formattedHTML += `<li>${line.trim()}</li>`;
          
          // Check if next line is not a similar format, close the list
          if (i + 1 >= lines.length || (!lines[i + 1].match(/^\d+\.\s/) && !lines[i + 1].includes(": "))) {
            formattedHTML += `</ul>`;
          }
        } else {
          formattedHTML += `<p>${line}</p>`;
        }
      }
    }
    
    // Close any open section and the main container
    if (currentSection && hasAddedSection) {
      formattedHTML += `</div>`;
    }
    formattedHTML += `</div>`;
    
    return formattedHTML;
  };

  // Add a new function to handle automatic continuation
  const handleContinuation = async () => {
    try {
      console.log('Automatically continuing conversation...');
      
      // Add loading message
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '...',
        isLoading: true
      }]);

      // Check if this is an early stage in the conversation
      const isEarlyStage = messageCount < 3 || currentStep === 'start';

      // Send a continuation request - using fetchWithAuth instead of fetch
      const response = await fetchWithAuth('https://medbot-bknd.onrender.com/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          response: "continue", // Send a special token to indicate automatic continuation
          preserve_context: !isEarlyStage // Only preserve context if we're not in early stages
        }),
      });

      // Remove loading message
      setMessages(prev => prev.filter(msg => !msg.isLoading));

      if (!response.ok) {
        const errorStatus = response.status;
        const errorData = await response.json().catch(() => ({}));
        console.error('Server error details:', errorData);
        
        // Handle different error statuses appropriately
        if (errorStatus === 401) {
          logout();
          navigate('/login');
          throw new Error('Session expired. Please login again.');
        } else {
          throw new Error(`Server error: ${errorStatus}`);
        }
      }

      const data = await response.json();
      
      if (!data.next_question) {
        throw new Error('Invalid response format from server');
      }

      // Add the bot's response to the chat
      const botMessage = { role: 'assistant', content: data.next_question };
      setMessages(prev => [...prev, botMessage]);
      
      // Update current step
      if (data.current_step) {
        setCurrentStep(data.current_step);
        
        if (data.current_step === "end") {
          setConversationComplete(true);
          fetchUserData();
        }
      }
      
      // Increment message count - important for tracking conversation progress
      setMessageCount(prev => prev + 1);
      
    } catch (error) {
      console.error('Error in automatic continuation:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I couldn't continue automatically. As an alternative, please try the "Get Diagnosis" button to generate a diagnosis based on our conversation so far.`
      }]);
      
      // Show the diagnosis option regardless of where we are in the conversation
      setShowSummaryButton(true);
    }
  };

  // Add logic to determine when a message is invalid feedback
  const isInvalidFeedback = (message) => {
    // Don't treat responses as invalid if we're just starting a new conversation (message count < 3)
    if (messageCount < 3) {
      return false;
    }
    
    return message.role === 'assistant' && 
           message.content.includes("doesn't seem to address my question");
  };

  // Add this function to the ChatPage component
  const handleInvalidResponse = async () => {
    try {
      // Add loading message
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Processing your response...',
        isLoading: true
      }]);

      // Remove loading message after a short delay
      setTimeout(() => {
        setMessages(prev => prev.filter(msg => !msg.isLoading));
        
        // Add a transition message
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: "I notice we're having some trouble with the conversation flow. Let me try to provide a diagnosis based on the information so far."
        }]);
        
        // Skip the problematic backend call and directly request diagnosis
        setTimeout(() => {
          requestDiagnosis();
        }, 1500);
      }, 1000);
      
    } catch (error) {
      console.error('Error in handling invalid response:', error);
      setMessages(prev => prev.filter(msg => !msg.isLoading));
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I encountered an error. Let me try to generate a diagnosis with what I know.`
      }]);
      
      // Still try to get a diagnosis
      setTimeout(() => {
        requestDiagnosis();
      }, 1500);
    }
  };

  // Add this function to manually trigger continuation
  const triggerContinuation = () => {
    handleContinuation();
  };

  // Update the requestDiagnosis function to save recommendations
  const requestDiagnosis = async () => {
    try {
      // Add loading message
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Generating medical diagnosis based on our conversation...',
        isLoading: true
      }]);

      // Request diagnosis - using fetchWithAuth instead of fetch
      const response = await fetchWithAuth('https://medbot-bknd.onrender.com/force_diagnosis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          fallback: true // Add fallback flag to handle LLM errors more gracefully
        }),
      });

      // Remove loading message
      setMessages(prev => prev.filter(msg => !msg.isLoading));

      if (!response.ok) {
        const errorStatus = response.status;
        const errorData = await response.json().catch(() => ({}));
        console.error('Server error details:', errorData);
        
        // Handle different error statuses appropriately
        if (errorStatus === 401) {
          logout();
          navigate('/login');
          throw new Error('Session expired. Please login again.');
        } else if (errorData.detail && errorData.detail.includes("AIMessage")) {
          // LLM-specific error
          throw new Error('The AI model encountered an error processing your information. Please try again with a simpler query.');
        } else {
          throw new Error(`Server error: ${errorStatus}`);
        }
      }

      const data = await response.json();
      
      // Add the diagnosis to the chat
      const diagnosisMessage = { role: 'assistant', content: data.next_question };
      setMessages(prev => [...prev, diagnosisMessage]);
      
      // Update current step
      setCurrentStep(data.current_step || "diagnosis");
      
      // Mark conversation as complete even if we don't get criticality step
      setConversationComplete(true);
      setShowSummaryButton(true);
      fetchUserData();
      
      // If we're now at criticality, fetch user data and save recommendation to history
      if (data.current_step === "criticality" || data.current_step === "criticality_node") {
        // Save the recommendation to chat history
        saveSummaryToHistory("Medical Recommendation", data.next_question);
      }
      
    } catch (error) {
      console.error('Error getting diagnosis:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `I apologize, but I'm having trouble generating a complete diagnosis due to a technical issue: ${error.message}. You can try starting a new consultation with more specific symptoms or try again later.`
      }]);
      
      // Still mark conversation as complete to avoid loops
      setConversationComplete(true);
    }
  };

  // Add this helper function to determine if the consultation has reached the recommendation stage
  const hasReachedRecommendations = () => {
    // Check if any message contains urgency level text or recommendation headers
    return messages.some(m => 
      m.content && (
        m.content.includes("URGENCY LEVEL") || 
        m.content.includes("PRECAUTIONS") ||
        m.content.includes("TIMEFRAME") ||
        (m.content.includes("LIKELY CONDITION") && m.content.includes("ACTION STEPS"))
      )
    );
  };

  // Render the message bubbles with updated styling
  const renderMessage = (message, index) => {
    const isInvalid = isInvalidFeedback(message);
                      
    const isPartialAnswer = message.role === 'assistant' && 
                            messageCount >= 3 && // Only apply this logic after a few messages
                            (message.content.includes("Could you please also tell me about") ||
                             message.content.includes("You mentioned seeing a doctor") ||
                             message.content.includes("also share what diagnosis"));
                    
    const needsContinuation = message.role === 'assistant' && 
                             (message.content.includes("I'll now analyze your symptoms") ||
                              message.content.includes("provide a preliminary diagnosis"));
                      
    // Check if the message contains HTML
    const containsHTML = message.role === 'assistant' && 
                         (message.content.includes('<div class="') || 
                          message.content.includes('<div class=') ||
                          message.content.includes('</div>'));
                      
    // Detect if this is a likely condition message (diagnosis)
    const isDiagnosis = message.role === 'assistant' && 
                       (message.content.includes('LIKELY CONDITION') || 
                        message.content.includes('## LIKELY CONDITION'));
                      
    // Apply special styling for diagnosis even if not HTML
    const diagnosisStyle = isDiagnosis && !containsHTML ? 'bg-blue-50 border-blue-200' : '';
                      
    return (
      <div
        key={index}
        className={`mb-4 ${
          message.role === 'user' ? 'flex justify-end' : 'flex justify-start'
        }`}
      >
        <div
          className={`p-4 rounded-lg max-w-[80%] shadow-md ${
            message.role === 'user'
              ? 'bg-blue-500 text-white'
              : isInvalid
                ? 'bg-amber-100 text-amber-800 border border-amber-300' 
                : isPartialAnswer
                  ? 'bg-orange-100 text-orange-800 border border-orange-300'
                  : diagnosisStyle || 'bg-white text-gray-800 border border-gray-200'
          } ${message.role === 'assistant' ? 'diagnosis-formatting' : ''}`}
        >
          {/* Render HTML content if it contains HTML */}
          {containsHTML ? (
            <div dangerouslySetInnerHTML={{ __html: message.content }} />
          ) : isDiagnosis ? (
            // Special formatting for diagnosis text that isn't HTML
            <div className="diagnosis-manual">
              {message.content.split('##').map((section, i) => {
                if (i === 0) return null; // Skip anything before the first ##
                
                const [heading, ...contentArr] = section.split('\n');
                const content = contentArr.join('\n').trim();
                
                return (
                  <div key={i} className="mb-3">
                    <div className="text-blue-700 font-bold mb-1">{heading.trim()}</div>
                    <div className="ml-2">{content}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            message.content
          )}
          
          {(isInvalid || isPartialAnswer) && (
            <button
              onClick={handleInvalidResponse}
              className="mt-2 p-1.5 bg-white hover:bg-gray-100 text-gray-800 text-sm rounded-md border border-gray-300 shadow-sm flex items-center gap-1 transition-colors"
            >
              <BsArrowRightCircle size={14} />
              <span>Continue Anyway</span>
            </button>
          )}
          {needsContinuation && (
            <button
              onClick={triggerContinuation}
              className="mt-2 p-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md shadow-sm flex items-center gap-1 transition-colors"
            >
              <BsArrowRightCircle size={14} />
              <span>Get Diagnosis</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  const stepInfo = getStepInfo();

  // Update fetch calls to include the authorization token
  const fetchWithAuth = async (url, options = {}) => {
    const token = localStorage.getItem('medbot_token');
    
    if (!token) {
      navigate('/login');
      throw new Error('Not authenticated');
    }
    
    const authOptions = {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${token}`
      }
    };
    
    return fetch(url, authOptions);
  };

  // Add logout functionality
  const handleLogout = () => {
    logout(); // Use the logout function from context
    navigate('/login');
  };

  // Update the fetchChatHistory function to filter duplicates
  const fetchChatHistory = async (userId) => {
    try {
      const response = await fetchWithAuth(`https://medbot-bknd.onrender.com/chat_history/${userId}`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.chat_history && Array.isArray(data.chat_history)) {
          // First filter to only include summary entries
          const summaryEntries = data.chat_history.filter(entry => 
            entry.type === "summary" || 
            (entry.title && (
              entry.title === "Doctor Summary" || 
              entry.title === "Medical Recommendation"
            ))
          );
          
          // Then filter duplicates
          const uniqueHistoryEntries = filterDuplicateSummaries(summaryEntries);
          
          // Sort history by timestamp/id (newest first)
          const sortedHistory = [...uniqueHistoryEntries].sort((a, b) => {
            return new Date(b.timestamp || b.id) - new Date(a.timestamp || a.id);
          });
          
          setChatHistory(sortedHistory);
        }
      }
    } catch (error) {
      console.error('Error fetching chat history:', error);
    }
  };
  
  // Add a new function to filter duplicate summaries
  const filterDuplicateSummaries = (historyEntries) => {
    // Group by consultation session (assuming entries from the same session are close in time)
    const sessionMap = new Map();
    
    // First, sort by timestamp to ensure oldest entries come first
    const sortedEntries = [...historyEntries].sort((a, b) => {
      return new Date(a.timestamp || a.id) - new Date(b.timestamp || b.id);
    });
    
    // Process each entry
    sortedEntries.forEach(entry => {
      // For regular chat entries, always keep them
      if (!entry.type || entry.type !== "summary") {
        sessionMap.set(entry.id, entry);
        return;
      }
      
      // For summary entries, check if we have another summary within 5 minutes
      const entryTime = new Date(entry.timestamp || entry.id).getTime();
      let isDuplicate = false;
      
      // Check against existing summary entries
      sessionMap.forEach((existingEntry, existingId) => {
        if (existingEntry.type === "summary") {
          const existingTime = new Date(existingEntry.timestamp || existingEntry.id).getTime();
          const timeDiff = Math.abs(entryTime - existingTime) / (1000 * 60); // difference in minutes
          
          // If within 5 minutes of another summary, consider it from the same consultation
          if (timeDiff < 5) {
            // Keep only the doctor summary (or the most recent if both are the same type)
            if (entry.title === "Doctor Summary" || 
               (entry.title === existingEntry.title && entryTime > existingTime)) {
              // Replace the existing entry with this one
              sessionMap.delete(existingId);
              isDuplicate = false; // Reset to false so this one gets added
            } else {
              isDuplicate = true;
            }
          }
        }
      });
      
      // Add this entry if it's not a duplicate
      if (!isDuplicate) {
        sessionMap.set(entry.id, entry);
      }
    });
    
    return Array.from(sessionMap.values());
  };

  // Update the renderChatHistoryItem function to use the view_summary endpoint
  const renderChatHistoryItem = (entry) => {
    // Determine if this is a special entry like a summary or recommendation
    const isSummary = entry.type === "summary";
    const messagePreview = entry.messages && entry.messages.length > 0
      ? entry.messages[entry.messages.length - 1].content
      : "";
    
    // For HTML content, strip the HTML tags for the preview
    const stripHtml = (html) => {
      const tmp = document.createElement("DIV");
      tmp.innerHTML = html;
      return tmp.textContent || tmp.innerText || "";
    };
    
    const previewText = messagePreview.includes('<div') || messagePreview.includes('<h')
      ? stripHtml(messagePreview).substring(0, 50) + (stripHtml(messagePreview).length > 50 ? '...' : '')
      : messagePreview.substring(0, 50) + (messagePreview.length > 50 ? '...' : '');
    
    return (
      <div 
        key={entry.id} 
        className={`p-2 rounded border transition-colors cursor-pointer ${
          isSummary 
            ? 'bg-blue-50 border-blue-200 hover:bg-blue-100' 
            : 'bg-white border-gray-200 hover:bg-blue-50'
        }`}
        onClick={() => {
          // Logic to display this conversation
          console.log("Selected conversation:", entry);
          
          // If it's a summary/recommendation, display it without saving again
          if (isSummary) {
            // Just display from the already fetched data
            displaySummaryFromHistory(entry);
          } else {
            // For regular chat entries, display the conversation
            if (entry.messages && entry.messages.length > 0) {
              // Start a fresh chat with just these messages
              setMessages([
                { role: 'assistant', content: 'Here is a previous conversation:' },
                ...entry.messages
              ]);
              setCurrentStep('start');
              setConversationComplete(true);
            }
          }
        }}
      >
        <div className="flex items-center justify-between">
          <span className={`text-sm font-medium truncate max-w-[80%] ${
            isSummary ? 'text-blue-700' : 'text-gray-700'
          }`}>
            {entry.title}
          </span>
          <span className="text-xs text-gray-400">
            {new Date(entry.timestamp || entry.id).toLocaleDateString()}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-1 truncate">
          {previewText}
        </p>
      </div>
    );
  };
  
  // Add a helper function to display a summary from history
  const displaySummaryFromHistory = async (summaryEntry) => {
    // Show loading indicator
    setMessages([
      { role: 'assistant', content: 'Loading summary...' }
    ]);
    
    try {
      // Use the backend endpoint to get the full summary
      const response = await fetchWithAuth(`https://medbot-bknd.onrender.com/view_summary/${userId}/${summaryEntry.id}`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.summary && data.summary.messages && data.summary.messages.length > 0) {
          const summaryMessage = { role: 'assistant', content: data.summary.messages[0].content };
          setMessages([
            { role: 'assistant', content: `${data.summary.title} from ${new Date(data.summary.timestamp || data.summary.id).toLocaleDateString()}:` },
            summaryMessage
          ]);
        } else {
          // Fallback to using the preview data if the API request doesn't return usable data
          const summaryMessage = { role: 'assistant', content: summaryEntry.messages[0].content };
          setMessages([
            { role: 'assistant', content: `${summaryEntry.title} from ${new Date(summaryEntry.timestamp || summaryEntry.id).toLocaleDateString()}:` },
            summaryMessage
          ]);
        }
      } else {
        // API error, use fallback
        console.error('Error fetching summary:', response.statusText);
        const summaryMessage = { role: 'assistant', content: summaryEntry.messages[0].content };
        setMessages([
          { role: 'assistant', content: `${summaryEntry.title} from ${new Date(summaryEntry.timestamp || summaryEntry.id).toLocaleDateString()}:` },
          summaryMessage
        ]);
      }
    } catch (error) {
      console.error('Error fetching summary:', error);
      // Fallback to the data we already have
      const summaryMessage = { role: 'assistant', content: summaryEntry.messages[0].content };
      setMessages([
        { role: 'assistant', content: `${summaryEntry.title} from ${new Date(summaryEntry.timestamp || summaryEntry.id).toLocaleDateString()}:` },
        summaryMessage
      ]);
    }
    
    // Reset state to show we're viewing a historical summary
    setCurrentStep('start'); 
    setConversationComplete(true);
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar - with scrollable content */}
      <div className="w-64 bg-white border-r border-gray-200 shadow-sm flex flex-col h-screen">
        {/* Scrollable sidebar content */}
        <div className="p-4 overflow-y-auto flex-grow">
          {/* User profile section */}
          {user && (
            <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
              <div className="flex items-center mb-2">
                <div className="bg-blue-500 text-white rounded-full w-8 h-8 flex items-center justify-center">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="ml-2">
                  <p className="font-medium text-gray-800">{user.name}</p>
                  <p className="text-xs text-gray-500">{user.email}</p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Sign out
              </button>
            </div>
          )}

          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <MdMedicalServices className="text-blue-500" />
            <span>Medical Assistant</span>
          </h2>
          
          {/* Current step indicator */}
          {currentStep !== 'start' && (
            <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
              <p className="text-gray-500 text-sm mb-1">Current step:</p>
              <div className="flex items-center gap-2 text-blue-700 font-medium">
                {conversationComplete ? <FiCheckCircle /> : stepInfo.icon}
                <span>{conversationComplete ? "Diagnosis Complete" : stepInfo.name}</span>
              </div>
            </div>
          )}
          
          {/* Progress steps */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-gray-600 text-sm mb-2 font-medium">Consultation Progress</p>
            <div className="space-y-2">
              {Object.entries({
                "symptoms": "Symptoms",
                "previous_history": "Medical History",
                "medication_history": "Medications",
                "additional_symptoms": "Additional Info",
                "diagnosis": "Diagnosis",
                "criticality": "Recommendations"
              }).map(([key, label]) => {
                // Determine if this step should be marked as completed (green)
                let isCompleted = false;
                
                // Map current step to completed progress indicators
                const stepsCompleted = {
                  // Initial steps
                  "start": [],
                  
                  // Symptom collection steps (all mark Symptoms as complete)
                  "initial_assessment": ["symptoms"],
                  "dynamic_symptoms": ["symptoms"],
                  "injury_assessment": ["symptoms"],
                  "infection_assessment": ["symptoms"],
                  "digestive_assessment": ["symptoms"],
                  "respiratory_assessment": ["symptoms"],
                  "chronic_condition": ["symptoms"],
                  "urgent_follow_up": ["symptoms"],
                  "emergency_services": ["symptoms"],
                  
                  // Medical history steps (mark Symptoms and Medical History as complete)
                  "previous_history": ["symptoms", "previous_history"],
                  "prev_history_node": ["symptoms", "previous_history"],
                  
                  // Medication steps (mark Symptoms, Medical History, and Medications as complete)
                  "medication_history": ["symptoms", "previous_history", "medication_history"],
                  "med_history_node": ["symptoms", "previous_history", "medication_history"],
                  
                  // Additional symptoms (mark all previous steps as complete)
                  "additional_symptoms": ["symptoms", "previous_history", "medication_history", "additional_symptoms"],
                  "additional_symptoms_node": ["symptoms", "previous_history", "medication_history", "additional_symptoms"],
                  
                  // Diagnosis preparation (everything except recommendations)
                  "diagnosis_prep": ["symptoms", "previous_history", "medication_history", "additional_symptoms", "diagnosis"],
                  
                  // Diagnosis (everything except recommendations)
                  "diagnosis": ["symptoms", "previous_history", "medication_history", "additional_symptoms", "diagnosis"],
                  "diagnosis_node": ["symptoms", "previous_history", "medication_history", "additional_symptoms", "diagnosis"],
                  
                  // Final steps (everything complete)
                  "criticality": ["symptoms", "previous_history", "medication_history", "additional_symptoms", "diagnosis", "criticality"],
                  "criticality_node": ["symptoms", "previous_history", "medication_history", "additional_symptoms", "diagnosis", "criticality"],
                  "end": ["symptoms", "previous_history", "medication_history", "additional_symptoms", "diagnosis", "criticality"]
                };
                
                // Check if the current step has this key as completed
                const completedItems = stepsCompleted[currentStep] || [];
                isCompleted = completedItems.includes(key);
                
                // Also check if patient data has this information to handle cases where step might not be accurate
                if (key === "symptoms" && patientData.symptoms && patientData.symptoms.length > 0) {
                  isCompleted = true;
                } else if (key === "previous_history" && patientData.previous_history) {
                  isCompleted = true;
                } else if (key === "medication_history" && patientData.medication_history) {
                  isCompleted = true;
                } else if (key === "additional_symptoms" && patientData.additional_symptoms) {
                  isCompleted = true;
                } else if (key === "diagnosis" && patientData.diagnosis) {
                  isCompleted = true;
                } else if (key === "criticality" && conversationComplete) {
                  isCompleted = true;
                }
                
                return (
                  <div key={key} className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${
                      isCompleted
                        ? 'bg-green-500' 
                        : currentStep === key 
                          ? 'bg-blue-500' 
                          : 'bg-gray-300'
                    }`}></div>
                    <span className={`text-sm ${
                      currentStep === key 
                        ? 'text-blue-700 font-medium' 
                        : isCompleted
                          ? 'text-green-700'
                          : 'text-gray-600'
                    }`}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
          
          {/* Chat History Section */}
          {chatHistory.length > 0 && chatHistory.some(entry => entry.messages && entry.messages.length > 0) && (
            <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-gray-600 text-sm font-medium">Medical Summaries</p>
                {chatHistory.length > 0 && (
                  <button 
                    className="text-xs text-blue-600 hover:text-blue-800"
                    onClick={() => setChatHistory([])}
                  >
                    Clear
                  </button>
                )}
              </div>
              
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {chatHistory.slice(0, 10)
                  .filter(entry => entry.messages && entry.messages.length > 0)
                  .map((entry) => renderChatHistoryItem(entry))
                }
                
                {chatHistory.length > 10 && (
                  <div className="text-center text-xs text-gray-500 pt-1">
                    + {chatHistory.length - 10} more summaries
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Get Diagnosis button - Only show when conversation has started but not completed */}
          {!conversationComplete && currentStep !== 'start' && (
            <div className="mt-4 text-center">
              <button
                onClick={requestDiagnosis}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                <FiFileText />
                <span>Get Diagnosis</span>
              </button>
            </div>
          )}
          
          {/* Generate Summary button */}
          {(showSummaryButton || currentStep === "criticality" || currentStep === "criticality_node" || currentStep === "end") && (
            <div className="mt-4 text-center">
              <button
                onClick={generateCaseSummary}
                className="w-full bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-lg transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                <FiFileText />
                <span>Doctor Summary</span>
              </button>
            </div>
          )}
          
          {/* New consultation button */}
          {conversationComplete && (
            <div className="mt-4 text-center pb-4">
              <button
                onClick={startNewConsultation}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2.5 transition-colors shadow-sm flex items-center justify-center gap-2"
              >
                <FiPlus />
                <span>Start New Consultation</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area - fixed layout */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Chat header - fixed at top */}
        <div className="p-4 border-b border-gray-200 bg-white shadow-sm">
          <div className="max-w-3xl mx-auto flex justify-between items-center">
            <h1 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <MdOutlineHealthAndSafety className="text-blue-500" />
              <span>Preliminary Diagnosis</span>
            </h1>
            <div className="text-sm text-gray-500 flex items-center gap-1">
              <FiClock className="text-gray-400" />
              <span>Session ID: {userId.substring(0, 8)}</span>
            </div>
          </div>
        </div>
        
        {/* Chat Messages - scrollable */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
          <div className="max-w-3xl mx-auto">
            {messages.map((message, index) => renderMessage(message, index))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area - fixed at bottom */}
        <div className="border-t border-gray-200 p-4 bg-white">
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
            <div className="flex gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="flex-1 bg-white text-gray-800 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-gray-300 shadow-sm"
                placeholder="Type your message..."
                disabled={conversationComplete}
              />
              <button
                type="submit"
                className={`px-5 py-3 rounded-lg transition-colors shadow-sm flex items-center gap-1.5 ${
                  conversationComplete
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
                disabled={conversationComplete}
              >
                <FiSend />
                <span>Send</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ChatPage; 
