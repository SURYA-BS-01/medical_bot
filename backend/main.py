from fastapi import FastAPI, HTTPException, Depends, status
from pydantic import BaseModel
import langgraph
from langgraph.graph import StateGraph, START
from typing import Dict, List, Optional
from fastapi.middleware.cors import CORSMiddleware
from langchain_groq import ChatGroq
import os
from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import PyMongoError
from datetime import datetime, timedelta
import uuid
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext

# Load environment variables
load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# MongoDB Connection
MONGODB_URI = os.getenv("MONGODB_URI")
client = MongoClient(MONGODB_URI)
db = client.medbot_db
users_collection = db.users

# Password and JWT Security
SECRET_KEY = os.getenv("SECRET_KEY", "a_default_secret_key_for_development_only")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# Initialize LLM
llm = ChatGroq(model="llama-3.3-70b-versatile", groq_api_key=GROQ_API_KEY)


# Initialize FastAPI
app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simulating a persistent database (replace with actual DB if needed)
user_data_store = {}

# User Response Model
class UserResponse(BaseModel):
    user_id: str
    response: str

# User Data Model (for tracking conversation state)
class UserData(BaseModel):
    user_id: str
    history: List[Dict[str, str]] = []
    is_existing: bool = False
    symptoms: List[str] = []
    previous_history: str = ""
    medication_history: str = ""
    additional_symptoms: str = ""
    diagnosis: str = ""
    critical: bool = False

# Function to get user state
def get_user_data(user_id: str):
    return user_data_store.get(user_id, UserData(user_id=user_id))

# Function to update user data with validation details
def update_user_data(user_id: str, key: str, value: str, validation_details=None):
    user = get_user_data(user_id)
    
    # Make sure the value is a string, not a dictionary
    if isinstance(value, dict):
        # Convert dict to string if accidentally passed
        value = str(value)
    
    # Add the new entry with validation details if provided
    entry = {key: value}
    if validation_details:
        entry["validation_details"] = validation_details
    
    user.history.append(entry)
    
    # Also update specific fields based on key
    if key == "symptoms":
        user.symptoms.append(value)
    elif key == "previous_history":
        user.previous_history = value
    elif key == "medication_history":
        user.medication_history = value
    elif key == "additional_symptoms":
        user.additional_symptoms = value
        if value.lower() not in ["no", "none", "not really", "that's all"]:
            user.symptoms.append(value)
    elif key == "diagnosis":
        user.diagnosis = value
    elif key == "critical":
        user.critical = value.lower() == "yes"
    elif key == "current_question":
        # Just store in history, don't update specific fields
        pass
    elif key == "current_step":
        # Just store in history, don't update specific fields
        pass
    
    user_data_store[user_id] = user

# Update the ChatState model to track urgency and custom conversation paths
class ChatState(BaseModel):
    user_id: str
    response: Optional[str] = None
    is_existing: Optional[bool] = None
    symptoms: Optional[List] = []
    previous_history: Optional[str] = None
    medication_history: Optional[str] = None
    additional_symptoms: Optional[str] = None
    diagnosis: Optional[str] = None
    critical: Optional[bool] = False
    current_question: Optional[str] = None
    current_step: Optional[str] = "start"
    # Add new fields for dynamic conversation
    urgency_level: Optional[str] = "normal"  # "urgent", "normal", "low"
    custom_path: Optional[str] = None  # Used to track specialized conversation paths
    custom_context: Optional[dict] = {}  # Store context-specific data (e.g., foods for diarrhea)
    
    class Config:
        arbitrary_types_allowed = True

# Helper function to ensure we're working with dictionaries
def ensure_dict(state):
    """Ensure the state is a dictionary."""
    if isinstance(state, ChatState):
        state_dict = {
            "user_id": state.user_id,
            "response": state.response,
            "is_existing": state.is_existing,
            "symptoms": state.symptoms or [],
            "previous_history": state.previous_history or "",
            "medication_history": state.medication_history or "",
            "additional_symptoms": state.additional_symptoms or "",
            "diagnosis": state.diagnosis or "",
            "critical": state.critical or False,
            "current_question": state.current_question,
            "current_step": state.current_step or "start",
            "urgency_level": state.urgency_level or "normal",
            "custom_path": state.custom_path,
            "custom_context": state.custom_context or {}  # Initialize custom_context
        }
        return state_dict
    else:
        # If it's already a dict, make sure custom_context exists
        if isinstance(state, dict):
            if "custom_context" not in state:
                state["custom_context"] = {}
        return state

# Ask question function for conversation flow
def ask_question(state, question, key, next_step):
    try:
        state_dict = ensure_dict(state)
        user_id = state_dict["user_id"]
        user_response = state_dict.get("response")
        
        # Store the response if there is one
        if user_response:
            update_user_data(user_id, key, user_response)
        
        # Set the next question and step
        state_dict["current_question"] = question
        state_dict["current_step"] = next_step
        return state_dict
        
    except Exception as e:
        print(f"Error in ask_question: {str(e)}")
        state_dict = ensure_dict(state) if state else {"user_id": "unknown"}
        state_dict["current_question"] = "I apologize, but I encountered an error. Could you please try again?"
        return state_dict

# Modify the start_node function for proper validation from the beginning
def start_node(state):
    state_dict = ensure_dict(state)
    user_id = state_dict["user_id"]
    user_response = state_dict.get("response", "")
    
    # Check if this is a first-time call vs a response to the greeting
    if not user_response:
        # First time - just set up the user and return a greeting
        user_data = get_user_data(user_id)
        is_new_user = user_id not in user_data_store
        state_dict["is_existing"] = not is_new_user
        
        if is_new_user:
            user_data_store[user_id] = user_data
            state_dict["current_question"] = "Hello! I'm your medical assistant. Could you please describe your symptoms or health concern in detail?"
        else:
            state_dict["current_question"] = "Welcome back! How are you feeling today? Please describe your current health concern in detail."
        
        # Set next step to be symptoms collection
        state_dict["current_step"] = "initial_assessment"
        return state_dict
    
    # For responses to the greeting, perform the urgency assessment
    return assess_initial_urgency(state)

# Modify the conversation flow to strictly follow the steps
# Each function should only handle one step and not skip ahead

# Update the symptom collection node - only ask about symptoms
def collect_symptoms_handler(state):
    state_dict = ensure_dict(state)
    user_id = state_dict["user_id"]
    user_response = state_dict.get("response", "")

    # Check if we have a valid response
    if user_response and user_response != "continue":
        # The response has already been validated, so we can extract symptoms
        update_user_data(user_id, "symptoms", user_response)
    
    # Next question about previous doctor consultation
    state_dict["current_question"] = "Have you consulted a doctor about these symptoms before? If yes, what was their diagnosis?"
    state_dict["current_step"] = "previous_history"
    return state_dict

# Update the previous_history_handler to enforce complete answers
def previous_history_handler(state):
    state_dict = ensure_dict(state)
    user_id = state_dict["user_id"]
    user_response = state_dict.get("response", "")
    
    # Always save the response, even if brief
    update_user_data(user_id, "previous_history", user_response)
    
    # Extract any diagnosis information from the response
    has_consulted_doctor = False
    extracted_diagnosis = ""
    
    # Simple parsing logic for common responses
    lower_response = user_response.lower()
    
    # Check if the response is just "yes" without diagnosis
    if lower_response == "yes":
        # We should keep the same step and ask for the diagnosis
        state_dict["current_question"] = "What was the doctor's diagnosis?"
        state_dict["current_step"] = "previous_history"  # Stay in the same step
        return state_dict
    
    # Process more complex responses
    if "yes" in lower_response or "diagnosed" in lower_response or "doctor said" in lower_response:
        has_consulted_doctor = True
        # Try to extract the diagnosis
        if "with" in lower_response and "diagnosed" in lower_response:
            parts = lower_response.split("with")
            if len(parts) > 1:
                extracted_diagnosis = parts[1].strip()
        elif ":" in lower_response:
            parts = lower_response.split(":")
            if len(parts) > 1:
                extracted_diagnosis = parts[1].strip()
        else:
            # Just use the response if it seems like a condition
            common_conditions = ["fever", "flu", "cold", "infection", "virus", "allergy"]
            for condition in common_conditions:
                if condition in lower_response:
                    extracted_diagnosis = condition
                    break
    
    # If the response itself is just a condition name, extract it
    if lower_response in ["viral fever", "flu", "cold", "fever", "infection"]:
        has_consulted_doctor = True
        extracted_diagnosis = lower_response
    
    # Continue with the conversation flow
    if has_consulted_doctor and extracted_diagnosis:
        symptoms_text = ", ".join(get_user_data(user_id).symptoms)
        similar_diagnosis_prompt = f"For a patient with symptoms {symptoms_text} and a previous diagnosis of {extracted_diagnosis}, suggest 2-3 similar or related possible diagnoses. Keep it brief."
        similar_diagnosis = llm.invoke(similar_diagnosis_prompt)
        response = f"Thank you for sharing that information. Based on your previous diagnosis of {extracted_diagnosis}, some similar conditions could include: {similar_diagnosis.content}\n\nHave you taken any medications for this condition? If yes, what medications and did you experience any side effects?"
        state_dict["current_question"] = response
        state_dict["current_step"] = "medication_history"
    elif has_consulted_doctor and not extracted_diagnosis:
        # If they said yes but didn't provide a diagnosis
        state_dict["current_question"] = "What was the doctor's diagnosis?"
        state_dict["current_step"] = "previous_history"  # Stay in the same step
    else:
        # If they haven't consulted a doctor, move to medication history
        state_dict["current_question"] = "Have you taken any medications for this condition? If yes, what medications and did you experience any side effects?"
        state_dict["current_step"] = "medication_history"
    
    return state_dict

# Update the medication_history_handler with validation awareness
def medication_history_handler(state):
    state_dict = ensure_dict(state)
    user_id = state_dict["user_id"]
    user_response = state_dict.get("response", "")
    
    # Validated response can be processed directly
    update_user_data(user_id, "medication_history", user_response)
    
    # Extract validation details if available
    user_data = get_user_data(user_id)
    validation_details = next((item.get("validation_details") for item in reversed(user_data.history) 
                              if "validation_details" in item), None)
    
    # Customize response based on medication information
    medications = []
    if validation_details and "medications" in validation_details:
        medications = validation_details.get("medications", [])
    
    if medications:
        medication_list = ", ".join(medications)
        state_dict["current_question"] = f"Thank you for sharing that you've taken {medication_list}. Besides what you've already mentioned, are you experiencing any other symptoms that we should know about?"
    else:
        state_dict["current_question"] = "Besides what you've already mentioned, are you experiencing any other symptoms that we should know about?"
    
    state_dict["current_step"] = "additional_symptoms"
    return state_dict

# Update the additional_symptoms_handler to immediately generate diagnosis
def additional_symptoms_handler(state):
    state_dict = ensure_dict(state)
    user_id = state_dict["user_id"]
    user_response = state_dict.get("response", "")
    
    # Save validated additional symptoms
    update_user_data(user_id, "additional_symptoms", user_response)
    
    # Get validation details
    user_data = get_user_data(user_id)
    validation_details = next((item.get("validation_details") for item in reversed(user_data.history) 
                              if "validation_details" in item), None)
    
    has_additional_symptoms = False
    additional_symptoms = []
    
    if validation_details:
        has_additional_symptoms = validation_details.get("has_additional_symptoms", False)
        additional_symptoms = validation_details.get("additional_symptoms", [])
    
    # First, inform user that diagnosis is being prepared
    intermediate_message = ""
    if has_additional_symptoms and additional_symptoms:
        symptoms_list = ", ".join(additional_symptoms)
        intermediate_message = f"Thank you for sharing these additional symptoms: {symptoms_list}. I'll now analyze all your symptoms and provide a preliminary diagnosis."
    else:
        intermediate_message = "Thank you for this information. I'll now analyze your symptoms and provide a preliminary diagnosis."
    
    # Store this intermediate message, but DON'T return it - we'll generate the diagnosis right away
    update_user_data(user_id, "intermediate_message", intermediate_message)
    
    # Generate diagnosis immediately without requiring another user input
    symptoms_text = ", ".join(user_data.symptoms)
    prev_history = user_data.previous_history
    med_history = user_data.medication_history
    add_symptoms = user_data.additional_symptoms
    
    diagnosis_prompt = f"""Based on the following patient information, provide a detailed diagnosis:
    
    Symptoms: {symptoms_text}
    Previous Medical History: {prev_history}
    Medication History: {med_history}
    Additional Symptoms: {add_symptoms}
    
    Format your diagnosis as a clear bulleted list with:
    • Most likely condition(s)
    • Brief explanation for each condition
    • Key symptoms supporting this diagnosis
    
    Use bullet points (•) for main points and sub-bullets (-) for details.
    """
    
    diagnosis = llm.invoke(diagnosis_prompt)
    update_user_data(user_id, "diagnosis", diagnosis.content)
    
    # Set the diagnosis as the current question and move to criticality step
    state_dict["current_question"] = diagnosis.content
    state_dict["current_step"] = "criticality"
    return state_dict

# Update the diagnosis_prep_handler function to create better formatted output
def diagnosis_prep_handler(state):
    state_dict = ensure_dict(state)
    user_id = state_dict["user_id"]
    
    # Initialize custom_context if not present
    if "custom_context" not in state_dict:
        state_dict["custom_context"] = {}
    
    # Create a local variable for easier access
    custom_context = state_dict["custom_context"]
    
    # Get user data
    user_data = get_user_data(user_id)
    
    # Check for critical health conditions first
    has_asthma = False
    lost_inhaler = False
    breathing_issues = False
    
    for item in user_data.history:
        for key, value in item.items():
            if isinstance(value, str):
                if "asthma" in value.lower():
                    has_asthma = True
                if "lost" in value.lower() and "inhaler" in value.lower():
                    lost_inhaler = True
                if any(phrase in value.lower() for phrase in ["can't breathe", "cant breathe", "difficulty breathing"]):
                    breathing_issues = True
    
    # Extract all user inputs to create a comprehensive patient history
    all_inputs = []
    for item in user_data.history:
        for key, value in item.items():
            # Only include user responses, not system messages or questions
            if key in ["symptoms", "previous_history", "medication_history", "additional_symptoms", "response"]:
                if isinstance(value, str) and len(value) > 3 and "continue" not in value.lower():
                    all_inputs.append(value)
    
    # Create a comprehensive patient description
    patient_description = "\n".join(all_inputs)
    
    # Enhanced diagnosis prompt that focuses on relevant conditions
    diagnosis_prompt = f"""
    You are a medical AI assistant providing a preliminary analysis of a patient's symptoms.
    Based on the following patient description, provide a focused, relevant diagnosis:
    
    {patient_description}
    
    IMPORTANT: Your diagnosis must:
    1. Be DIRECTLY RELEVANT to the symptoms actually mentioned by the patient
    2. Focus on the most likely condition based on their specific description
    3. Provide actionable advice that addresses their particular situation
    4. Be clear, concise, and formatted for easy reading
    
    Format your response with these EXACT headings:
    
    ## LIKELY CONDITION
    [Provide the most likely condition and a brief explanation - 2-3 sentences maximum]
    
    ## ACTION STEPS
    • [First action step - specific and relevant to this condition]
    • [Second action step]
    • [Third action step if necessary]
    
    ## NOTE
    [A brief note about when to consult a doctor - 1 sentence]
    
    DO NOT include generic advice that isn't directly related to the patient's specific symptoms.
    """
    
    diagnosis = llm.invoke(diagnosis_prompt)
    update_user_data(user_id, "diagnosis", diagnosis.content)
    
    # Format the diagnosis as HTML for better presentation
    diagnosis_text = diagnosis.content.strip()
    
    # Extract sections
    condition_section = ""
    action_steps = []
    note = "Consult a doctor if symptoms worsen or persist."
    
    # Parse the diagnosis content into sections
    if "LIKELY CONDITION" in diagnosis_text:
        parts = diagnosis_text.split("##")
        for part in parts:
            if "LIKELY CONDITION" in part:
                condition_section = part.replace("LIKELY CONDITION", "").strip()
            elif "ACTION STEPS" in part:
                actions_text = part.replace("ACTION STEPS", "").strip()
                action_steps = [step.strip().replace("•", "").strip() for step in actions_text.split("\n") if step.strip() and "•" in step]
                if not action_steps:  # If bullet extraction failed, try line by line
                    action_steps = [line.strip() for line in actions_text.split("\n") if line.strip() and not line.strip().startswith("##")]
            elif "NOTE" in part:
                note = part.replace("NOTE", "").strip()
    
    # If parsing failed, extract at least something
    if not condition_section:
        condition_section = "Unable to determine specific condition from symptoms provided"
    
    if not action_steps:
        action_steps = ["Rest and stay hydrated", "Monitor your symptoms", "Consult with a healthcare professional"]
    
    # Create HTML formatted diagnosis
    formatted_html = f"""<div class="diagnosis-card">
  <div class="diagnosis-header">LIKELY CONDITION</div>
  <div class="diagnosis-content">{condition_section}</div>
  
  <div class="diagnosis-header">ACTION STEPS</div>
  <ul class="diagnosis-list">"""
    
    # Add each action step
    for step in action_steps:
        formatted_html += f"\n    <li>{step}</li>"
    
    formatted_html += f"""
  </ul>
  
  <div class="diagnosis-header">NOTE</div>
  <div class="diagnosis-note">{note}</div>
</div>"""
    
    state_dict["current_question"] = formatted_html
    state_dict["current_step"] = "criticality"
    return state_dict

# Update the generate_diagnosis function with the same improved format
def generate_diagnosis(state):
    state_dict = ensure_dict(state)
    user_id = state_dict["user_id"]
    user_data = get_user_data(user_id)
    
    # Generate diagnosis
    symptoms_text = ", ".join(user_data.symptoms)
    prev_history = user_data.previous_history
    med_history = user_data.medication_history
    add_symptoms = user_data.additional_symptoms
    
    diagnosis_prompt = f"""
    Based on the following patient information, provide a concise, patient-friendly diagnosis:
    
    Symptoms: {symptoms_text}
    Previous Medical History: {prev_history}
    Medication History: {med_history}
    Additional Symptoms: {add_symptoms}
    
    Requirements:
    1. Keep the diagnosis clear, concise, and easy to read
    2. Use no more than 2-3 paragraphs total
    3. If multiple conditions are possible, only mention the 1-2 most likely ones
    4. Include specific, practical recommendations for the patient
    5. For common conditions, include widely recognized first-aid or home care advice
    
    Format your response in THREE sections with these EXACT headings:
    
    ## LIKELY CONDITION
    [Brief, simple explanation of the most likely diagnosis in 2-3 sentences]
    
    ## ACTION STEPS
    • [First immediate action the patient should take]
    • [Whether and when to seek medical attention]
    • [Specific home care recommendations if applicable]
    
    ## MEDICAL NOTE
    [A brief medical disclaimer that this is not a complete diagnosis]
    
    For common urgent conditions, include standard medical recommendations:
    - Heart attack: Take aspirin if not allergic, call emergency services
    - Burns: Cool with water, don't apply butter/oil, cover with clean cloth
    - Cuts: Apply pressure, clean with water, use sterile bandage
    - Diabetes crisis: Check blood sugar, take insulin as prescribed, call doctor
    - Asthma attack: Use rescue inhaler, sit upright, seek help if not improving
    """
    
    diagnosis = llm.invoke(diagnosis_prompt)
    update_user_data(user_id, "diagnosis", diagnosis.content)
    
    # Format the diagnosis as HTML
    formatted_html = f"""<div class="diagnosis-card">
  <div class="diagnosis-header">LIKELY CONDITION</div>
  <div class="diagnosis-content">
    {diagnosis.content.split("ACTION STEPS")[0].strip()}
  </div>
  
  <div class="diagnosis-header">ACTION STEPS</div>
  <ul class="diagnosis-list">
    <li>Rest more</li>
    <li>Drink plenty of fluids</li>
    <li>Take over-the-counter medication for symptoms</li>
  </ul>
  
  <div class="diagnosis-header">NOTE</div>
  <div class="diagnosis-note">Consult a doctor if symptoms worsen or don't improve within a few days.</div>
</div>"""
    
    state_dict["current_question"] = formatted_html
    state_dict["current_step"] = "criticality"
    return state_dict

# Criticality assessment with improved formatting
def assess_criticality(state):
    state_dict = ensure_dict(state)
    user_id = state_dict["user_id"]
    user_data = get_user_data(user_id)
    
    symptoms_text = ", ".join(user_data.symptoms)
    prev_history = user_data.previous_history
    med_history = user_data.medication_history
    diagnosis = user_data.diagnosis
    
    urgency_check_prompt = f"""Based on the following patient information:
    
    Symptoms: {symptoms_text}
    Previous Medical History: {prev_history}
    Medication History: {med_history}
    Diagnosis: {diagnosis}
    
    Is this potentially an urgent medical situation requiring immediate attention?
    Answer with ONLY 'YES' or 'NO'.
    """
    
    urgency_response = llm.invoke(urgency_check_prompt).strip().upper()
    
    if urgency_response == 'YES':
        print("Detected urgent medical situation, routing to urgent follow-up handler")
        state_dict["urgency_level"] = "urgent"
        update_user_state(user_id, state_dict)
        return urgent_follow_up_handler(state_dict)
    
    criticality_prompt = f"""Based on the following patient information:
    
    Symptoms: {symptoms_text}
    Previous Medical History: {prev_history}
    Medication History: {med_history}
    Diagnosis: {diagnosis}
    
    Provide a clear assessment of urgency and recommendations.
    
    Format your response with EXACTLY these sections:
    
    ## URGENCY LEVEL
    [State whether this is URGENT (needs immediate care), PROMPT (see doctor soon), or ROUTINE]
    
    ## TIMEFRAME
    [When the patient should see a doctor: immediately, within 24 hours, within a week, or at their convenience]
    
    ## PRECAUTIONS
    • [First precaution as a bullet point]
    • [Second precaution as a bullet point]
    • [Third precaution as a bullet point if applicable]
    
    ## DISCLAIMER
    [A brief medical disclaimer that this is not a substitute for professional care]
    """
    
    assessment = llm.invoke(criticality_prompt)
    assessment_text = assessment.content
    
    is_critical = "URGENT" in assessment_text
    update_user_data(user_id, "critical", "yes" if is_critical else "no")
    
    state_dict["current_question"] = assessment_text
    state_dict["current_step"] = "end"
    return state_dict

# Add a new handler for generating summary
def generate_summary(state):
    state_dict = ensure_dict(state)
    user_id = state_dict["user_id"]
    user_data = get_user_data(user_id)
    
    if not user_data or not user_data.symptoms:
        return {"summary": "## Medical Case Summary\n\nInsufficient data to generate a medical case summary. Please complete the consultation."}
    
    # Create a professional medical summary for doctors
    symptoms_text = ", ".join(user_data.symptoms)
    
    # Extract validation details for more accurate summary
    history_with_validation = [item for item in user_data.history if "validation_details" in item]
    extracted_details = {}
    
    for entry in history_with_validation:
        validation = entry.get("validation_details", {})
        if "extracted_symptoms" in validation:
            extracted_details["symptoms"] = validation["extracted_symptoms"]
        if "extracted_diagnosis" in validation:
            extracted_details["diagnosis"] = validation["extracted_diagnosis"]
        if "medications" in validation:
            extracted_details["medications"] = validation["medications"]
        if "side_effects" in validation:
            extracted_details["side_effects"] = validation["side_effects"]
    
    summary_prompt = f"""Generate a concise, professional medical case summary for a doctor based on the following patient information:
    
    Presenting Symptoms: {symptoms_text}
    Medical History: {user_data.previous_history}
    Medication History: {user_data.medication_history}
    Additional Symptoms: {user_data.additional_symptoms}
    Preliminary Diagnosis: {user_data.diagnosis}
    Urgency Assessment: {"Urgent medical attention recommended" if user_data.critical else "Routine follow-up recommended"}
    
    Additional Extracted Details: {extracted_details}
    
    Format the summary as a professional medical case summary that a physician would find useful. Include only factual information provided by the patient. Structure the summary with clear headings for Chief Complaint, History, Medications, Assessment, and Recommendations.
    """
    
    summary = llm.invoke(summary_prompt)
    return {"summary": f"## Medical Case Summary\n\n{summary.content}"}

# Update function to specifically handle accidents
def assess_initial_urgency(state):
    state_dict = ensure_dict(state)
    
    # Make sure custom_context is initialized
    if "custom_context" not in state_dict:
        state_dict["custom_context"] = {}
    
    user_id = state_dict["user_id"]
    user_response = state_dict.get("response", "")
    
    # ACCIDENT DETECTION: Explicitly check for accident-related phrases
    accident_keywords = ["accident", "crash", "fell", "injured", "hit", "collision", "car accident"]
    if any(keyword in user_response.lower() for keyword in accident_keywords):
        # Set high urgency for accidents
        state_dict["urgency_level"] = "urgent"
        state_dict["custom_path"] = "injury_assessment"
        state_dict["custom_context"] = {
            "category": "injury",
            "key_symptoms": ["accident", "injury"],
            "reasoning": "Patient mentioned being in an accident"
        }
        
        # Store the accident information
        update_user_data(user_id, "accident_info", user_response)
        update_user_data(user_id, "symptoms", "accident injury")
        
        # Generate specific questions for accidents
        accident_prompt = f"""
        The patient has said: "{user_response}"
        
        They have mentioned being in an accident. Ask them specific questions to:
        1. Determine if there's any bleeding, head injury, or severe pain
        2. Find out if they can move all limbs
        3. Check if they've lost consciousness at any point
        4. Determine if emergency services were called
        
        Format as 2-3 clear questions that assess the urgency of their injuries.
        """
        
        accident_questions = llm.invoke(accident_prompt)
        
        # Format the emergency message with bold numbered points
        state_dict["current_question"] = f"""<div class="urgent-message">
<div class="urgent-header">⚠️ URGENT MEDICAL SITUATION ⚠️</div>
<div class="urgent-content">
  <p><strong>1.</strong> Call 911 immediately</p>
  <p><strong>2.</strong> Stay calm and seated</p>
  <p><strong>3.</strong> Take aspirin if available</p>
  <p><strong>4.</strong> Loosen tight clothing</p>
</div>
<div class="urgent-footer">If this is life-threatening, stop using this app and call emergency services (911) immediately.</div>
</div>"""
        
        state_dict["current_step"] = "urgent_follow_up"
        return state_dict
    
    # Check for known chronic conditions first
    chronic_conditions = ["diabetes", "diabetic", "hypertension", "asthma", "copd", "arthritis", "thyroid"]
    mentioned_conditions = [c for c in chronic_conditions if c in user_response.lower()]
    
    if mentioned_conditions:
        # Create a customized follow-up for chronic conditions
        condition = mentioned_conditions[0]  # Use the first mentioned condition
        
        # Store the condition information
        state_dict["urgency_level"] = "routine"
        state_dict["custom_path"] = "chronic_condition"
        state_dict["custom_context"] = {
            "category": "chronic",
            "key_symptoms": [condition],
            "reasoning": f"Patient mentioned {condition}, which is a chronic condition"
        }
        
        # Store condition in user data
        update_user_data(user_id, "medical_condition", condition)
        update_user_data(user_id, "symptoms", condition)
        
        # Generate condition-specific follow-up
        condition_questions = {
            "diabetes": "Thank you for sharing that you have diabetes. Is this Type 1 or Type 2 diabetes? And are you experiencing any specific issues related to your condition right now?",
            "diabetic": "Thank you for mentioning you're diabetic. Is this Type 1 or Type 2 diabetes? And are you experiencing any specific issues related to your condition right now?",
            "hypertension": "Thank you for letting me know about your hypertension. Are you currently experiencing any symptoms like headache, dizziness, or chest pain?",
            "asthma": "Thank you for sharing that you have asthma. Are you currently experiencing any breathing difficulties or increased use of your rescue inhaler?"
        }
        
        # Set specific question based on condition, or use a generic one
        state_dict["current_question"] = condition_questions.get(
            condition, 
            f"Thank you for sharing that you have {condition}. Could you tell me more about any current symptoms or concerns related to your condition?"
        )
        
        state_dict["current_step"] = "chronic_condition"
        return state_dict
    
    # Create a prompt to evaluate urgency
    urgency_prompt = f"""
    Based on the following patient description, assess the medical urgency:
    
    Patient description: "{user_response}"
    
    Rate the urgency as:
    1. URGENT - requires immediate medical attention (bleeding, trouble breathing, severe injury)
    2. PROMPT - should be addressed soon but not an emergency
    3. ROUTINE - standard medical concern
    
    Also identify the primary medical issue category (e.g., injury, infection, chronic condition).
    Explain your reasoning briefly.
    
    Format your response as JSON:
    {{
        "urgency_level": "URGENT/PROMPT/ROUTINE",
        "category": "primary medical issue category",
        "reasoning": "brief explanation",
        "key_symptoms": ["symptom1", "symptom2"],
        "recommended_questions": ["question1", "question2"]
    }}
    """
    
    urgency_assessment = llm.invoke(urgency_prompt)
    
    # Extract JSON from the response
    import json
    import re
    
    json_pattern = r'\{.*\}'
    json_match = re.search(json_pattern, urgency_assessment.content, re.DOTALL)
    
    if json_match:
        try:
            assessment = json.loads(json_match.group())
        except:
            # Default assessment if JSON parsing fails
            assessment = {
                "urgency_level": "ROUTINE",
                "category": "general",
                "reasoning": "Unable to determine urgency from description",
                "key_symptoms": [],
                "recommended_questions": []
            }
    else:
        # Default assessment if JSON parsing fails
        assessment = {
            "urgency_level": "ROUTINE",
            "category": "general",
            "reasoning": "Unable to determine urgency from description",
            "key_symptoms": [],
            "recommended_questions": []
        }
    
    # Update the state with urgency assessment
    state_dict["urgency_level"] = assessment["urgency_level"].lower()
    state_dict["custom_context"] = {
        "category": assessment.get("category", "general"),
        "key_symptoms": assessment.get("key_symptoms", []),
        "reasoning": assessment.get("reasoning", "")
    }
    
    # Store the assessment in user data
    update_user_data(user_id, "urgency_assessment", json.dumps(assessment))
    
    # For URGENT cases, create a simpler message without relying on markdown
    if assessment.get("urgency_level") == "URGENT":
        urgent_advice_prompt = f"""
        The patient has described: "{user_response}"
        
        Based on this information, provide 4 urgent first aid steps for this
        medical situation. Format as a simple numbered list with only the most critical
        steps to take immediately.
        
        Example format:
        1. Call emergency services
        2. Specific action to take
        3. Another critical action
        4. Final immediate instruction
        """
        
        urgent_advice = llm.invoke(urgent_advice_prompt)
        
        # Format the emergency message with the entire advice content
        state_dict["current_question"] = f"""<div class="urgent-message">
<div class="urgent-header">⚠️ URGENT MEDICAL GUIDANCE ⚠️</div>
<div class="urgent-content">
  {urgent_advice.content}
</div>
<div class="urgent-footer">If this is life-threatening, stop using this app and call emergency services (911) immediately.</div>
</div>"""
        
        state_dict["current_step"] = "urgent_follow_up"
        return state_dict
    
    # For less urgent cases, generate dynamic personalized questions
    next_questions_prompt = f"""
    The patient has described: "{user_response}"
    
    Based on this information and the medical category identified ({assessment.get("category", "general")}),
    generate the most relevant next question to ask.
    
    Consider:
    1. The specific symptoms described ({', '.join(assessment.get("key_symptoms", []))})
    2. The urgency level ({assessment.get("urgency_level", "ROUTINE")})
    3. What additional information would help most with diagnosis
    
    Your question should be tailored to the specific medical situation, not generic.
    For example, if they mentioned diarrhea, ask about recent food consumption and travel.
    
    Format your response as a direct question to the patient.
    """
    
    next_question = llm.invoke(next_questions_prompt)
    
    # Set dynamic question and create a custom conversation path
    state_dict["current_question"] = next_question.content
    
    # Choose appropriate next step based on category
    category_to_path = {
        "injury": "injury_assessment",
        "infection": "infection_assessment",
        "digestive": "digestive_assessment",
        "respiratory": "respiratory_assessment",
        "chronic": "chronic_condition",
        # Add more mappings as needed
    }
    
    # Set custom path or default to symptoms collection
    category = assessment.get("category", "").lower()
    if category in category_to_path:
        state_dict["custom_path"] = category_to_path[category]
        state_dict["current_step"] = category_to_path[category]
    else:
        state_dict["current_step"] = "dynamic_symptoms"
    
    return state_dict

# Add a generic dynamic follow-up question handler
def dynamic_follow_up_handler(state):
    state_dict = ensure_dict(state)
    
    # Make sure custom_context is initialized
    if "custom_context" not in state_dict:
        state_dict["custom_context"] = {}
    
    user_id = state_dict["user_id"]
    user_response = state_dict.get("response", "")
    current_context = state_dict.get("custom_context", {})
    current_step = state_dict.get("current_step", "dynamic_symptoms")
    
    # Save the user's response in the appropriate category
    update_user_data(user_id, current_step, user_response)
    
    # Update context with new information
    current_context["last_response"] = user_response
    
    # ADDED: Track conversation turn count for this handler
    if "turn_count" not in current_context:
        current_context["turn_count"] = 1
    else:
        current_context["turn_count"] = current_context["turn_count"] + 1
    
    # ADDED: Force diagnosis after a maximum number of turns (4-5 is usually sufficient)
    if current_context["turn_count"] >= 4:
        state_dict["custom_context"] = current_context
        state_dict["current_question"] = "Thank you for all this information. I have enough details now to analyze your situation and provide a preliminary diagnosis."
        state_dict["current_step"] = "diagnosis_prep"
        return state_dict
    
    # Get all previous responses to build context
    user_data = get_user_data(user_id)
    conversation_history = [
        f"Patient: {item.get(key, '')}" 
        for item in user_data.history 
        for key in item 
        if key not in ["current_question", "current_step", "validation", "validation_details"]
    ]
    
    # Create a prompt for generating the next question based on all previous information
    next_question_prompt = f"""
    Patient history:
    {conversation_history[-5:] if len(conversation_history) > 5 else conversation_history}
    
    Latest response: "{user_response}"
    
    Current medical category: {current_context.get("category", "general medical issue")}
    Key symptoms identified: {', '.join(current_context.get("key_symptoms", []))}
    Urgency level: {state_dict.get("urgency_level", "normal")}
    Turn count: {current_context["turn_count"]}
    
    Based on all this information, what is the most relevant next question to ask?
    Consider what additional information would be most valuable for diagnosis.
    
    IMPORTANT: If we now have enough information OR we've asked {current_context["turn_count"]} questions already, 
    indicate that we should move to diagnosis.
    
    Generate a personalized follow-up question that naturally continues this specific medical conversation.
    DO NOT ask generic questions that don't relate to their specific condition.
    
    Format your response as JSON:
    {{
        "next_question": "your specific follow-up question",
        "move_to_diagnosis": true/false,
        "reasoning": "brief explanation why we should/shouldn't move to diagnosis",
        "additional_context": {{
            "key": "value" // any additional context to track
        }}
    }}
    """
    
    response = llm.invoke(next_question_prompt)
    
    # Extract JSON from the response
    import json
    import re
    
    json_pattern = r'\{.*\}'
    json_match = re.search(json_pattern, response.content, re.DOTALL)
    
    if json_match:
        try:
            follow_up = json.loads(json_match.group())
        except:
            follow_up = {
                "next_question": "Could you tell me more about your symptoms?",
                "move_to_diagnosis": False,
                "reasoning": "Could not determine validity",
                "additional_context": {}
            }
    else:
        # Default if JSON parsing fails
        follow_up = {
            "next_question": "Could you tell me more about your symptoms?",
            "move_to_diagnosis": False,
            "reasoning": "Could not determine validity",
            "additional_context": {}
        }
    
    # Update context with new information
    if "additional_context" in follow_up and follow_up["additional_context"]:
        current_context.update(follow_up["additional_context"])
    
    state_dict["custom_context"] = current_context
    
    # Check if we should move to diagnosis or continue gathering information
    if follow_up.get("move_to_diagnosis", False):
        # We have enough information for diagnosis
        state_dict["current_question"] = "Thank you for all this information. I'll now analyze your symptoms and provide a preliminary diagnosis."
        state_dict["current_step"] = "diagnosis_prep"
    else:
        # Continue with dynamic questioning
        state_dict["current_question"] = follow_up["next_question"]
        
        # Determine if we should change the path based on new information
        if "path_update" in follow_up:
            state_dict["custom_path"] = follow_up["path_update"]
            state_dict["current_step"] = follow_up["path_update"]
        else:
            # Stay on current path but advance the step number
            state_dict["current_step"] = f"{current_step}_continued"
    
    return state_dict

# Add handlers for urgent situations
def urgent_follow_up_handler(state):
    state_dict = ensure_dict(state)
    user_id = state_dict["user_id"]
    user_response = state_dict.get("response", "")
    
    update_user_data(user_id, "urgent_follow_up", user_response)
    
    # Get user data to provide context
    user_data = get_user_data(user_id)
    
    # Extract all relevant inputs to understand the patient's situation
    all_inputs = []
    for item in user_data.history:
        for key, value in item.items():
            if key in ["symptoms", "previous_history", "medication_history", "additional_symptoms", "response"]:
                if isinstance(value, str) and len(value) > 3:
                    all_inputs.append(value)
    
    # Create a comprehensive patient description
    patient_description = "\n".join(all_inputs)
    
    # Generate urgency-specific prompt based on the actual medical situation
    prompt = f"""
    Based on this patient's information:
    
    {patient_description}
    
    Provide 4 SPECIFIC emergency first aid steps that are directly relevant to their condition.
    These should be clear, actionable instructions that address their urgent medical situation.
    
    Format your response as 4 numbered steps, each being a concise, direct instruction.
    """
    
    urgent_advice = llm.invoke(prompt)
    
    # Parse the response to extract specific steps
    advice_text = urgent_advice.content
    
    # Define default steps in case parsing fails
    default_steps = [
        "Call emergency services (911) immediately",
        "Sit upright and try to stay calm",
        "Remove any restrictive clothing",
        "Breathe slowly through pursed lips"
    ]
    
    # Try to extract numbered steps
    import re
    numbered_steps = re.findall(r'\d+\.\s*(.*?)(?=\d+\.|$)', advice_text, re.DOTALL)
    
    # Use extracted steps if available, otherwise use defaults
    steps = [step.strip() for step in numbered_steps if step.strip()] if len(numbered_steps) >= 3 else default_steps
    
    # Ensure we have exactly 4 steps
    while len(steps) < 4:
        steps.append(default_steps[len(steps)])
    
    # Format the emergency message with properly structured HTML
    state_dict["current_question"] = f"""<div class="urgent-message">
<div class="urgent-header">⚠️ URGENT MEDICAL SITUATION ⚠️</div>
<div class="urgent-content">
  <p><strong>1.</strong> {steps[0]}</p>
  <p><strong>2.</strong> {steps[1]}</p>
  <p><strong>3.</strong> {steps[2]}</p>
  <p><strong>4.</strong> {steps[3]}</p>
</div>
<div class="urgent-footer">If this is life-threatening, stop using this app and call emergency services (911) immediately.</div>
</div>"""
    
    state_dict["current_step"] = "emergency_services"
    return state_dict

# Define the graph with updated nodes and flow
graph = StateGraph(state_schema=ChatState)

# Define nodes with dynamic capabilities
graph.add_node("start", start_node)
graph.add_node("collect_symptoms", collect_symptoms_handler)
graph.add_node("prev_history_node", previous_history_handler)
graph.add_node("med_history_node", medication_history_handler)
graph.add_node("additional_symptoms_node", additional_symptoms_handler)
graph.add_node("diagnosis_prep", diagnosis_prep_handler)
graph.add_node("diagnosis_node", generate_diagnosis)
graph.add_node("criticality_node", assess_criticality)
graph.add_node("summary_node", generate_summary)

# Add new dynamic nodes
graph.add_node("initial_assessment", assess_initial_urgency)
graph.add_node("dynamic_symptoms", dynamic_follow_up_handler)
graph.add_node("injury_assessment", dynamic_follow_up_handler)
graph.add_node("infection_assessment", dynamic_follow_up_handler)
graph.add_node("digestive_assessment", dynamic_follow_up_handler)
graph.add_node("respiratory_assessment", dynamic_follow_up_handler)
graph.add_node("chronic_condition", dynamic_follow_up_handler)
graph.add_node("urgent_follow_up", urgent_follow_up_handler)
graph.add_node("emergency_services", urgent_follow_up_handler)

# Connect nodes with flexible flow
graph.add_edge(START, "start")
graph.add_edge("start", "initial_assessment")

# Connect initial assessment to different paths
graph.add_edge("initial_assessment", "dynamic_symptoms")
graph.add_edge("initial_assessment", "injury_assessment")
graph.add_edge("initial_assessment", "infection_assessment")
graph.add_edge("initial_assessment", "digestive_assessment")
graph.add_edge("initial_assessment", "respiratory_assessment")
graph.add_edge("initial_assessment", "chronic_condition")
graph.add_edge("initial_assessment", "urgent_follow_up")

# Connect dynamic symptom collectors to themselves for continuation
graph.add_edge("dynamic_symptoms", "dynamic_symptoms")
graph.add_edge("injury_assessment", "injury_assessment")
graph.add_edge("infection_assessment", "infection_assessment")
graph.add_edge("digestive_assessment", "digestive_assessment")
graph.add_edge("respiratory_assessment", "respiratory_assessment")
graph.add_edge("chronic_condition", "chronic_condition")

# Connect urgent paths
graph.add_edge("urgent_follow_up", "emergency_services")
graph.add_edge("emergency_services", "emergency_services")

# Connect all paths to diagnosis
graph.add_edge("dynamic_symptoms", "diagnosis_prep")
graph.add_edge("injury_assessment", "diagnosis_prep") 
graph.add_edge("infection_assessment", "diagnosis_prep")
graph.add_edge("digestive_assessment", "diagnosis_prep")
graph.add_edge("respiratory_assessment", "diagnosis_prep")
graph.add_edge("chronic_condition", "diagnosis_prep")
graph.add_edge("urgent_follow_up", "diagnosis_prep")
graph.add_edge("emergency_services", "diagnosis_prep")

# Connect original nodes for backward compatibility
graph.add_edge("collect_symptoms", "prev_history_node")
graph.add_edge("prev_history_node", "med_history_node")
graph.add_edge("med_history_node", "additional_symptoms_node")
graph.add_edge("additional_symptoms_node", "diagnosis_prep")
graph.add_edge("diagnosis_prep", "diagnosis_node")
graph.add_edge("diagnosis_node", "criticality_node")

# Compile Graph
chatbot = graph.compile()

# Add these new models for user registration
class UserRegistration(BaseModel):
    name: str
    email: str
    password: str
    gender: str
    age: int
    comorbidities: List[str] = []
    medications: List[str] = []
    allergies: List[str] = []

class UserLogin(BaseModel):
    email: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

# User authentication helper functions
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

# User database functions
def get_user_by_email(email: str):
    user = users_collection.find_one({"email": email})
    return user

def authenticate_user(email: str, password: str):
    user = get_user_by_email(email)
    if not user:
        return False
    if not verify_password(password, user["hashed_password"]):
        return False
    return user

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
        token_data = TokenData(email=email)
    except JWTError:
        raise credentials_exception
    user = get_user_by_email(email=token_data.email)
    if user is None:
        raise credentials_exception
    return user

# Add these new endpoints for user registration and login
@app.post("/register", response_model=dict)
async def register_user(user_data: UserRegistration):
    # Check if user already exists
    existing_user = users_collection.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create new user document
    new_user = {
        "user_id": f"user-{uuid.uuid4().hex[:8]}",
        "name": user_data.name,
        "email": user_data.email,
        "hashed_password": get_password_hash(user_data.password),
        "gender": user_data.gender,
        "age": user_data.age,
        "comorbidities": user_data.comorbidities,
        "medications": user_data.medications,
        "allergies": user_data.allergies,
        "created_at": datetime.utcnow(),
        "chat_history": []
    }
    
    try:
        users_collection.insert_one(new_user)
        # Create access token
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={"sub": user_data.email}, expires_delta=access_token_expires
        )
        
        return {
            "user_id": new_user["user_id"],
            "name": new_user["name"],
            "email": new_user["email"],
            "access_token": access_token,
            "token_type": "bearer"
        }
    except PyMongoError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {str(e)}"
        )

@app.post("/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    user = authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user["email"]}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/login", response_model=dict)
async def login_user(user_data: UserLogin):
    user = authenticate_user(user_data.email, user_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user_data.email}, expires_delta=access_token_expires
    )
    
    return {
        "user_id": user["user_id"],
        "name": user["name"],
        "email": user["email"],
        "access_token": access_token,
        "token_type": "bearer"
    }

@app.get("/users/me", response_model=dict)
async def read_users_me(current_user: dict = Depends(get_current_user)):
    return {
        "user_id": current_user["user_id"],
        "name": current_user["name"],
        "email": current_user["email"],
        "gender": current_user["gender"],
        "age": current_user["age"],
        "comorbidities": current_user["comorbidities"],
        "medications": current_user["medications"],
        "allergies": current_user["allergies"]
    }

# Modify the existing chat endpoint to work with registered users
@app.post("/chat")
async def chat(user_response: UserResponse, token: str = Depends(oauth2_scheme)):
    try:
        # Decode token to get user
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        user_db = get_user_by_email(email)
        
        if not user_db:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )
        
        # Use the user's ID from the database
        user_id = user_db["user_id"]
        
        # Rest of your existing chat logic here, using user_id
        print(f"Received request: {user_response}")
        
        # ADDED: Special handling for "get_diagnosis" token to force diagnosis generation
        if user_response.response in ["get_diagnosis", "provide diagnosis", "diagnose"]:
            # Create a state object for diagnosis
            user = get_user_data(user_id)
            state_dict = {
                "user_id": user_id,
                "response": "proceed to diagnosis",
                "is_existing": True,
                "symptoms": user.symptoms,
                "previous_history": user.previous_history,
                "medication_history": user.medication_history,
                "additional_symptoms": user.additional_symptoms,
                "diagnosis": user.diagnosis,
                "critical": user.critical,
                "current_step": "diagnosis_prep"
            }
            
            # Ensure state has custom_context initialized
            if "custom_context" not in state_dict:
                state_dict["custom_context"] = {}
            
            # Process through diagnosis_prep
            next_state = diagnosis_prep_handler(state_dict)
            
            # Extract and return
            next_question = next_state.get("current_question", "Unable to generate diagnosis with current information")
            
            # Store the updated state
            update_user_data(user_id, "current_question", next_question)
            update_user_data(user_id, "current_step", "criticality")
            
            # Store chat history in user document
            users_collection.update_one(
                {"user_id": user_id},
                {"$push": {"chat_history": {
                    "timestamp": datetime.utcnow(),
                    "user_message": user_response.response,
                    "bot_response": next_question
                }}}
            )
            
            return {"next_question": next_question, "current_step": "criticality"}
        
        # Special handling for "continue" token to always proceed to next step
        if user_response.response == "continue":
            if user_id in user_data_store:
                user = user_data_store[user_id]
                current_step = next((item.get("current_step") for item in reversed(user.history) 
                                   if "current_step" in item), "start")
                
                # Force progress to next step in the flow
                state_dict = {
                    "user_id": user_id,
                    "response": "continue",
                    "is_existing": True,
                    "symptoms": user.symptoms,
                    "previous_history": user.previous_history,
                    "medication_history": user.medication_history,
                    "additional_symptoms": user.additional_symptoms,
                    "diagnosis": user.diagnosis,
                    "critical": user.critical,
                    "current_step": current_step
                }
                
                # If we're at the additional_symptoms step, we need to move to diagnosis
                if current_step == "additional_symptoms":
                    next_step = determine_next_step(state_dict)
                else:
                    next_step = determine_next_step(state_dict)
                
                # Process the next step
                next_state = process_step(next_step, state_dict)
                
                # Extract question and step
                next_question = next_state.get("current_question", "What can I help you with?")
                current_step = next_state.get("current_step", "unknown")
                
                # Store the current question and step
                update_user_data(user_id, "current_question", next_question)
                update_user_data(user_id, "current_step", current_step)
                
                # Store chat history in user document
                users_collection.update_one(
                    {"user_id": user_id},
                    {"$push": {"chat_history": {
                        "timestamp": datetime.utcnow(),
                        "user_message": user_response.response,
                        "bot_response": next_question
                    }}}
                )
                
                return {"next_question": next_question, "current_step": current_step}
        
        # Check if this is a first-time interaction with this user
        is_first_interaction = user_id not in user_data_store
        
        # MAJOR FIX: Create the user record FIRST and process their input
        if is_first_interaction:
            # Initialize new user in data store
            user_data_store[user_id] = UserData(user_id=user_id)
            
            # Store their initial response as a symptom/issue
            update_user_data(user_id, "symptoms", user_response.response)
            
            # Create state dictionary with the actual user response
            state_dict = {
                "user_id": user_id,
                "response": user_response.response,  # <-- CRITICAL FIX: Use their actual response
                "is_existing": False,
                "symptoms": [user_response.response],
                "previous_history": None,
                "medication_history": None,
                "additional_symptoms": None,
                "diagnosis": None,
                "critical": False,
                "current_step": "initial_assessment"  # Go directly to assessment
            }
        else:
            # Get existing user
            user = user_data_store[user_id]
            
            # Extract current step to determine next action
            current_step = next((item.get("current_step") for item in reversed(user.history) 
                               if "current_step" in item), "start")
            
            # Create a state dict based on where we are in the conversation
            state_dict = {
                "user_id": user_id,
                "response": user_response.response,
                "is_existing": True,
                "symptoms": user.symptoms,
                "previous_history": user.previous_history,
                "medication_history": user.medication_history,
                "additional_symptoms": user.additional_symptoms,
                "diagnosis": user.diagnosis,
                "critical": user.critical,
                "current_step": current_step
            }
            
            # Skip validation for special tokens
            skip_validation = user_response.response in ["continue", "continue_anyway"]
            
            if not skip_validation:
                # Get the previous question to validate against
                previous_question = next((item.get("current_question") for item in reversed(user.history) 
                                         if "current_question" in item), "How can I help you?")
                
                # Determine the expected response type based on current step
                expected_type_map = {
                    "start": "symptoms",
                    "symptoms": "symptoms",
                    "previous_history": "previous_history",
                    "medication_history": "medication_history",
                    "additional_symptoms": "additional_symptoms",
                    "diagnosis_prep": "general",
                    "diagnosis": "general",
                    "criticality": "general",
                    "end": "general"
                }
                expected_type = expected_type_map.get(current_step, "general")
                
                # When processing validation results, check for partial answers 
                validation = await validate_response(previous_question, user_response.response, expected_type)
                
                # Store validation details for future use
                validation_details = validation.get("details", {})
                
                # If the response is invalid but it's a partial answer to a multi-part question
                if not validation["is_valid"]:
                    if validation_details.get("partial_answer", False):
                        # Store the partial answer but stay on the same step
                        update_user_data(user_id, "partial_" + current_step, user_response.response, validation_details)
                        
                        next_question = validation["feedback"]
                        
                        # Store chat history in user document
                        users_collection.update_one(
                            {"user_id": user_id},
                            {"$push": {"chat_history": {
                                "timestamp": datetime.utcnow(),
                                "user_message": user_response.response,
                                "bot_response": next_question
                            }}}
                        )
                        
                        return {
                            "next_question": next_question,
                            "current_step": current_step  # Stay on the same step
                        }
                    else:
                        # Regular invalid response
                        next_question = validation["feedback"]
                        
                        # Store chat history in user document
                        users_collection.update_one(
                            {"user_id": user_id},
                            {"$push": {"chat_history": {
                                "timestamp": datetime.utcnow(),
                                "user_message": user_response.response,
                                "bot_response": next_question
                            }}}
                        )
                        
                        return {
                            "next_question": next_question,
                            "current_step": current_step  # Stay on the same step
                        }
                
                # Update the response with processed version
                state_dict["response"] = validation["processed_response"]
                
                # Store validation details
                update_user_data(user_id, "validation", "valid", validation_details)
            elif user_response.response == "continue_anyway":
                # For continue_anyway, use the previous user response but skip validation
                last_user_response = next((item.get("response") for item in reversed(user.history) 
                                          if "response" in item), "")
                state_dict["response"] = last_user_response
        
        print(f"Processing state: {state_dict}")
        
        # Update the current step based on the conversation flow
        next_step = determine_next_step(state_dict)
        
        # Process just the specific node for this step
        next_state = process_step(next_step, state_dict)
        
        # Extract question and step from state
        if not isinstance(next_state, dict):
            raise HTTPException(status_code=500, detail=f"Expected dict, got {type(next_state)}")
            
        next_question = next_state.get("current_question", "What can I help you with?")
        current_step = next_state.get("current_step", "unknown")
        
        # Store the current question for future validation
        update_user_data(user_id, "current_question", next_question)
        
        # Store the current step in history for next time
        update_user_data(user_id, "current_step", current_step)
        
        print(f"Returning question: {next_question}, step: {current_step}")
        
        # Store chat history in user document
        users_collection.update_one(
            {"user_id": user_id},
            {"$push": {"chat_history": {
                "timestamp": datetime.utcnow(),
                "user_message": user_response.response,
                "bot_response": next_question
            }}}
        )
        
        return {"next_question": next_question, "current_step": current_step}
    
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials"
        )
    except Exception as e:
        print(f"Error in chat endpoint: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred: {str(e)}"
        )

# Helper function to determine the next step based on the current step
def determine_next_step(state):
    current_step = state.get("current_step", "start")
    custom_path = state.get("custom_path")
    
    # If we have a custom path, prioritize it
    if custom_path:
        return custom_path
    
    # For steps that end with "_continued", keep using the dynamic handler
    if current_step.endswith("_continued"):
        base_step = current_step.replace("_continued", "")
        return base_step
    
    # Define the conversation flow including dynamic steps
    step_flow = {
        "start": "start",
        "initial_assessment": "initial_assessment",
        "dynamic_symptoms": "dynamic_symptoms",
        "injury_assessment": "injury_assessment",
        "infection_assessment": "infection_assessment",
        "digestive_assessment": "digestive_assessment",
        "respiratory_assessment": "respiratory_assessment",
        "chronic_condition": "chronic_condition",
        "urgent_follow_up": "urgent_follow_up",
        "emergency_services": "emergency_services",
        "symptoms": "collect_symptoms",
        "previous_history": "prev_history_node",
        "medication_history": "med_history_node",
        "additional_symptoms": "additional_symptoms_node",
        "diagnosis_prep": "diagnosis_prep",
        "diagnosis": "diagnosis_node",
        "criticality": "criticality_node",
        "end": "end"
    }
    
    return step_flow.get(current_step, "initial_assessment")

# Process a specific step in the conversation
def process_step(step_name, state):
    state_dict = ensure_dict(state)
    
    if "custom_context" not in state_dict:
        state_dict["custom_context"] = {}
    
    if step_name.endswith("_continued") and "_continued_continued" in step_name:
        print(f"Detected nested continuations in {step_name}, forcing diagnosis")
        state_dict["current_question"] = "I believe I have sufficient information now. Let me provide a preliminary diagnosis based on what you've shared."
        state_dict["current_step"] = "diagnosis_prep"
        return diagnosis_prep_handler(state_dict)
    
    if step_name == "initial_assessment" and state_dict.get("response", "").lower() and "accident" in state_dict.get("response", "").lower():
        return assess_initial_urgency(state_dict)
    
    if step_name == "diagnosis_prep":
        return diagnosis_prep_handler(state_dict)
    elif step_name == "additional_symptoms_node":
        return additional_symptoms_handler(state_dict)
    
    handlers = {
        "start": start_node,
        "initial_assessment": assess_initial_urgency,
        "collect_symptoms": collect_symptoms_handler,
        "prev_history_node": previous_history_handler,
        "med_history_node": medication_history_handler,
        "additional_symptoms_node": additional_symptoms_handler,
        "diagnosis_prep": diagnosis_prep_handler,
        "diagnosis_node": generate_diagnosis,
        "criticality_node": assess_criticality,
        "dynamic_symptoms": dynamic_follow_up_handler,
        "injury_assessment": dynamic_follow_up_handler,
        "infection_assessment": dynamic_follow_up_handler,
        "digestive_assessment": dynamic_follow_up_handler,
        "respiratory_assessment": dynamic_follow_up_handler,
        "chronic_condition": dynamic_follow_up_handler,
        "urgent_follow_up": urgent_follow_up_handler,
        "emergency_services": urgent_follow_up_handler
    }
    
    handler = handlers.get(step_name)
    
    if handler:
        return handler(state_dict)
    else:
        print(f"Warning: Unknown step requested: {step_name}")
        return start_node(state_dict)

# Helper function to update user state
def update_user_state(user_id, state):
    if user_id not in user_data_store:
        user_data_store[user_id] = UserData(user_id=user_id)
    
    pass

@app.get("/user/{user_id}")
def get_user(user_id: str):
    user_data = get_user_data(user_id)
    return user_data

@app.get("/debug/users")
def debug_users():
    return {"user_count": len(user_data_store), "users": {k: v.dict() for k, v in user_data_store.items()}}

@app.post("/generate_summary")
async def generate_summary_endpoint(user_data_request: dict):
    try:
        user_id = user_data_request.get("user_id")
        if not user_id:
            raise HTTPException(status_code=400, detail="User ID is required")
            
        user_data = get_user_data(user_id)
        
        if not user_data or not user_data.symptoms:
            return {"summary": "## Medical Case Summary\n\nInsufficient data to generate a medical case summary. Please complete the consultation."}
        
        symptoms_text = ", ".join(user_data.symptoms)
        
        history_with_validation = [item for item in user_data.history if "validation_details" in item]
        extracted_details = {}
        
        for entry in history_with_validation:
            validation = entry.get("validation_details", {})
            if "extracted_symptoms" in validation:
                extracted_details["symptoms"] = validation["extracted_symptoms"]
            if "extracted_diagnosis" in validation:
                extracted_details["diagnosis"] = validation["extracted_diagnosis"]
            if "medications" in validation:
                extracted_details["medications"] = validation["medications"]
            if "side_effects" in validation:
                extracted_details["side_effects"] = validation["side_effects"]
        
        summary_prompt = f"""Generate a concise, professional medical case summary for a doctor based on the following patient information:
        
        Presenting Symptoms: {symptoms_text}
        Medical History: {user_data.previous_history}
        Medication History: {user_data.medication_history}
        Additional Symptoms: {user_data.additional_symptoms}
        Preliminary Diagnosis: {user_data.diagnosis}
        Urgency Assessment: {"Urgent medical attention recommended" if user_data.critical else "Routine follow-up recommended"}
        
        Additional Extracted Details: {extracted_details}
        
        Format the summary as a professional medical case summary that a physician would find useful. Include only factual information provided by the patient. Structure the summary with clear headings for Chief Complaint, History, Medications, Assessment, and Recommendations.
        """
        
        summary = llm.invoke(summary_prompt)
        return {"summary": f"## Medical Case Summary\n\n{summary.content}"}
        
    except Exception as e:
        print(f"Error generating summary: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

async def validate_response(question, response, expected_type):
    if response == "continue":
        return {"is_valid": True, "feedback": None, "processed_response": response}
    
    if expected_type == "previous_history" and response.lower() == "yes":
        return {
            "is_valid": False,
            "feedback": "You mentioned seeing a doctor. Could you please also share what diagnosis they provided?",
            "processed_response": response,
            "details": {
                "has_consulted_doctor": True,
                "extracted_diagnosis": "",
                "partial_answer": True
            }
        }
    
    if expected_type == "symptoms" and any(condition in response.lower() for condition in ["diabetes", "diabetic", "hypertension", "asthma", "chronic"]):
        conditions = []
        for condition in ["diabetes", "diabetic", "hypertension", "asthma", "copd", "arthritis", "thyroid"]:
            if condition in response.lower():
                conditions.append(condition)
        
        condition_str = ", ".join(conditions)
        
        return {
            "is_valid": True,
            "feedback": None,
            "processed_response": response,
            "details": {
                "is_valid": True,
                "reason": f"Patient disclosed medical condition: {condition_str}",
                "is_chronic_condition": True,
                "medical_conditions": conditions,
                "extracted_symptoms": conditions
            }
        }
    
    if len(response.strip()) <= 20:
        if expected_type == "symptoms" and response.lower() in ["hi", "hello"]:
            return {
                "is_valid": False,
                "feedback": "I need to understand your symptoms to help you. Could you please describe what health issues you're experiencing in more detail?",
                "processed_response": response,
                "details": {"is_valid": False, "reason": "Greeting instead of symptoms"}
            }
        elif expected_type == "symptoms" and not any(word in response.lower() for word in ["diabetes", "pain", "ache", "hurt", "sick"]):
            return {
                "is_valid": False,
                "feedback": "I notice your response is quite brief. Could you please provide more details about your current health concerns or symptoms? This will help me assist you better.",
                "processed_response": response,
                "details": {"is_valid": False, "reason": "The user's response is too brief and lacks detail about their current health concern."}
            }
        elif expected_type == "previous_history":
            has_consulted = "yes" in response.lower()
            extracted_diagnosis = response if "no" not in response.lower() else ""
            
            return {
                "is_valid": True, 
                "feedback": None, 
                "processed_response": response,
                "details": {
                    "is_valid": True,
                    "has_consulted_doctor": has_consulted,
                    "extracted_diagnosis": extracted_diagnosis
                }
            }
        else:
            return {"is_valid": True, "feedback": None, "processed_response": response}
    
    multi_part_check = validate_multi_part_response(question, response, expected_type)
    
    if not multi_part_check["is_complete"]:
        return {
            "is_valid": False,
            "feedback": f"Could you please also tell me about {multi_part_check['missing_part']}?",
            "processed_response": response,
            "details": {
                "is_valid": False,
                "reason": f"Incomplete answer to multi-part question. Missing: {multi_part_check['missing_part']}",
                "partial_answer": True
            }
        }
    
    validation_prompts = {
        "previous_history": f"""
            As a medical assistant, evaluate if the following response addresses medical history or doctor consultations.
            The question is about whether the patient has consulted a doctor about their symptoms before.
            A simple "yes" or "no" is valid. A diagnosis name like "viral fever" is a valid response.
            
            Question: "{question}"
            User Response: "{response}"
            
            Format your response as JSON:
            {{
                "is_valid": true/false,
                "reason": "brief explanation",
                "has_consulted_doctor": true/false,
                "extracted_diagnosis": "diagnosis" (if applicable)
            }}
            
            NOTE: Be very lenient in your evaluation. If the response could reasonably be interpreted as a 
            previous diagnosis or an indication they have/have not seen a doctor, mark it as valid.
        """,
        "symptoms": f"""
            As a medical assistant, evaluate if the following response describes medical symptoms.
            
            Question: "{question}"
            User Response: "{response}"
            
            First, determine if the user is describing any medical symptoms or health concerns.
            If yes, extract and list those symptoms.
            If no, explain why the response doesn't describe symptoms.
            
            Format your response as JSON:
            {{
                "is_valid": true/false,
                "reason": "brief explanation",
                "extracted_symptoms": ["symptom1", "symptom2"] (if applicable)
            }}
        """,
        "medication_history": f"""
            As a medical assistant, evaluate if the following response addresses medication history.
            
            Question: "{question}"
            User Response: "{response}"
            
            Determine if the user is describing medications they've taken.
            If yes, extract the medications mentioned. If they mention side effects, note those too.
            If no medications are mentioned or the response is off-topic, explain why.
            
            Format your response as JSON:
            {{
                "is_valid": true/false,
                "reason": "brief explanation",
                "medications": ["medication1", "medication2"] (if applicable),
                "side_effects": ["side effect1", "side effect2"] (if applicable)
            }}
        """,
        "additional_symptoms": f"""
            As a medical assistant, evaluate if the following response addresses additional symptoms.
            
            Question: "{question}"
            User Response: "{response}"
            
            Determine if the user is describing additional symptoms beyond what they've mentioned before.
            If yes, extract those additional symptoms.
            If they clearly state they have no additional symptoms, this is also valid.
            If the response is off-topic, explain why.
            
            Format your response as JSON:
            {{
                "is_valid": true/false,
                "reason": "brief explanation",
                "has_additional_symptoms": true/false,
                "additional_symptoms": ["symptom1", "symptom2"] (if applicable)
            }}
        """,
        "general": f"""
            As a medical assistant, evaluate if the following response is relevant to the question.
            
            Question: "{question}"
            User Response: "{response}"
            
            Determine if the user's response is addressing the question in a meaningful way.
            
            Format your response as JSON:
            {{
                "is_valid": true/false,
                "reason": "brief explanation",
                "processed_response": "cleaned up version of response" (if applicable)
            }}
        """
    }
    
    prompt = validation_prompts.get(expected_type, validation_prompts["general"])
    
    try:
        validation_result = llm.invoke(prompt)
        
        import json
        import re
        
        json_pattern = r'\{.*\}'
        json_match = re.search(json_pattern, validation_result.content, re.DOTALL)
        
        if json_match:
            validation_json = json.loads(json_match.group())
        else:
            validation_json = {
                "is_valid": True,
                "reason": "Could not determine validity",
                "processed_response": response
            }
        
        feedback = None
        if not validation_json.get("is_valid", True):
            feedback = f"I notice your response doesn't seem to address my question about {expected_type}. {validation_json.get('reason', '')} Could you please provide more specific information?"
        
        return {
            "is_valid": validation_json.get("is_valid", True),
            "feedback": feedback,
            "processed_response": validation_json.get("processed_response", response),
            "details": validation_json
        }
        
    except Exception as e:
        print(f"Validation error: {str(e)}")
        return {"is_valid": True, "feedback": None, "processed_response": response}

def validate_multi_part_response(question, response, expected_type):
    multi_part_patterns = {
        "previous_history": {
            "parts": ["Have you consulted a doctor", "what was their diagnosis"],
            "triggers": ["yes", "i have", "i did", "consulted"],
            "required_follow_up": ["diagnosis", "said", "told me", "found"],
        },
        "medication_history": {
            "parts": ["Have you taken any medications", "what medications", "side effects"],
            "triggers": ["yes", "i have", "i did", "taking", "took"],
            "required_follow_up": ["medication", "drug", "pill", "medicine", "paracetamol", "ibuprofen"],
        },
    }
    
    if expected_type not in multi_part_patterns:
        return {"is_complete": True}
    
    pattern = multi_part_patterns[expected_type]
    lower_response = response.lower()
    
    has_trigger = any(trigger in lower_response for trigger in pattern["triggers"])
    
    if has_trigger:
        has_follow_up = any(follow_up in lower_response for follow_up in pattern["required_follow_up"])
        
        if not has_follow_up:
            missing_part = pattern["parts"][1] if pattern["parts"][0] in question.lower() else pattern["parts"][0]
            return {
                "is_complete": False,
                "missing_part": missing_part
            }
    
    return {"is_complete": True}

@app.post("/force_diagnosis")
async def force_diagnosis(user_data_request: dict):
    try:
        user_id = user_data_request.get("user_id")
        if not user_id:
            raise HTTPException(status_code=400, detail="User ID is required")
            
        user_data = get_user_data(user_id)
        if not user_data:
            raise HTTPException(status_code=404, detail="User not found")
        
        has_asthma = False
        lost_inhaler = False
        breathing_issues = False
        
        for item in user_data.history:
            for key, value in item.items():
                if isinstance(value, str):
                    if "asthma" in value.lower():
                        has_asthma = True
                    if "lost" in value.lower() and "inhaler" in value.lower():
                        lost_inhaler = True
                    if any(phrase in value.lower() for phrase in ["can't breathe", "cant breathe", "difficulty breathing"]):
                        breathing_issues = True
        
        if has_asthma and (lost_inhaler or breathing_issues):
            urgent_html = f"""<div class="urgent-message">
<div class="urgent-header">⚠️ URGENT ASTHMA EMERGENCY ⚠️</div>
<div class="urgent-content">
  <p><strong>1.</strong> Call emergency services (911) immediately</p>
  <p><strong>2.</strong> Sit upright in a comfortable position</p>
  <p><strong>3.</strong> Try to remain calm and take slow breaths</p>
  <p><strong>4.</strong> Remove tight clothing and stay in fresh air</p>
</div>
<div class="urgent-footer">Without an inhaler, an asthma attack can be life-threatening. Seek emergency help immediately.</div>
</div>"""
            
            update_user_data(user_id, "current_question", urgent_html)
            update_user_data(user_id, "current_step", "emergency_services")
            
            return {
                "next_question": urgent_html,
                "current_step": "emergency_services"
            }
        
        state_dict = {
            "user_id": user_id,
            "response": "proceed to diagnosis",
            "is_existing": True,
            "symptoms": user_data.symptoms,
            "previous_history": user_data.previous_history,
            "medication_history": user_data.medication_history,
            "additional_symptoms": user_data.additional_symptoms,
            "diagnosis": user_data.diagnosis,
            "critical": user_data.critical,
            "current_step": "diagnosis_prep"
        }
        
        next_state = diagnosis_prep_handler(state_dict)
        
        diagnosis = next_state.get("current_question", "Unable to generate diagnosis with current information")
        
        update_user_data(user_id, "current_question", diagnosis)
        update_user_data(user_id, "current_step", "criticality")
        
        return {
            "next_question": diagnosis,
            "current_step": "criticality"
        }
        
    except Exception as e:
        print(f"Error in force_diagnosis endpoint: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# Add this new ChatHistoryEntry model class
class ChatHistoryEntry(BaseModel):
    user_id: str
    history_entry: dict

# Add the save_chat_history endpoint
@app.post("/save_chat_history")
async def save_chat_history(entry_data: ChatHistoryEntry, token: str = Depends(oauth2_scheme)):
    # Validate the user through token
    current_user = await get_current_user(token)
    if current_user["user_id"] != entry_data.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to save history for this user"
        )
    
    try:
        # Get the user's document from MongoDB
        user_doc = users_collection.find_one({"user_id": entry_data.user_id})
        
        if not user_doc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
            
        # Initialize chat_history if it doesn't exist
        if "chat_history" not in user_doc:
            user_doc["chat_history"] = []
        
        # Check if this is a summary entry
        is_summary = entry_data.history_entry.get("type") == "summary"
        
        if is_summary:
            # For summaries, check if we already have a summary from the same consultation
            # (within 5 minutes of this entry)
            entry_time = datetime.fromisoformat(entry_data.history_entry.get("timestamp")) if "timestamp" in entry_data.history_entry else datetime.fromtimestamp(entry_data.history_entry.get("id") / 1000)
            
            # Look for existing summaries in the last 5 minutes
            existing_summaries = []
            for i, history_item in enumerate(user_doc["chat_history"]):
                if history_item.get("type") == "summary":
                    item_time = datetime.fromisoformat(history_item.get("timestamp")) if "timestamp" in history_item else datetime.fromtimestamp(history_item.get("id") / 1000)
                    time_diff = abs((entry_time - item_time).total_seconds())
                    
                    # If within 5 minutes, consider it from the same consultation
                    if time_diff < 300:  # 5 minutes in seconds
                        existing_summaries.append((i, history_item))
            
            if existing_summaries:
                # If we have existing summaries from this consultation
                # If this is a Doctor Summary, replace any existing summary
                if entry_data.history_entry.get("title") == "Doctor Summary":
                    for idx, _ in existing_summaries:
                        user_doc["chat_history"].pop(idx)
                    user_doc["chat_history"].append(entry_data.history_entry)
                # Otherwise, only add if we don't already have a Doctor Summary
                else:
                    has_doctor_summary = any(s[1].get("title") == "Doctor Summary" for s in existing_summaries)
                    if not has_doctor_summary:
                        user_doc["chat_history"].append(entry_data.history_entry)
            else:
                # No existing summaries found, add this one
                user_doc["chat_history"].append(entry_data.history_entry)
        else:
            # Add the new history entry (not a summary)
            user_doc["chat_history"].append(entry_data.history_entry)
        
        # Update the user document
        users_collection.update_one(
            {"user_id": entry_data.user_id},
            {"$set": {"chat_history": user_doc["chat_history"]}}
        )
        
        return {"status": "success", "message": "Chat history saved successfully"}
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error saving chat history: {str(e)}"
        )

# Add a new endpoint to view historical summaries without saving again
@app.get("/view_summary/{user_id}/{summary_id}")
async def view_summary(user_id: str, summary_id: str, token: str = Depends(oauth2_scheme)):
    # Validate the user through token
    current_user = await get_current_user(token)
    if current_user["user_id"] != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access this summary"
        )
    
    try:
        # Get the user's document from MongoDB
        user_doc = users_collection.find_one({"user_id": user_id})
        
        if not user_doc or "chat_history" not in user_doc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User or chat history not found"
            )
        
        # Find the summary in the chat history
        summary = None
        for entry in user_doc["chat_history"]:
            # Check by id (could be string or int)
            entry_id = str(entry.get("id"))
            if entry_id == summary_id:
                summary = entry
                break
        
        if not summary:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Summary not found"
            )
        
        return {"summary": summary}
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error retrieving summary: {str(e)}"
        )

# Add endpoint to get chat history
@app.get("/chat_history/{user_id}")
async def get_chat_history(user_id: str, token: str = Depends(oauth2_scheme)):
    # Validate the user through token
    current_user = await get_current_user(token)
    if current_user["user_id"] != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access history for this user"
        )
    
    try:
        # Get the user's document from MongoDB
        user_doc = users_collection.find_one({"user_id": user_id})
        
        if not user_doc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
            
        # Return chat history or empty list if none exists
        chat_history = user_doc.get("chat_history", [])
        
        return {"chat_history": chat_history}
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error retrieving chat history: {str(e)}"
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
