import sys
from pathlib import Path
from enum import Enum
from typing import Literal

import joblib  # pyright: ignore[reportMissingTypeStubs]
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(  # pyright: ignore[reportAttributeAccessIssue, reportUnknownMemberType]
        encoding="utf-8", errors="replace"
    )

if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(  # pyright: ignore[reportAttributeAccessIssue, reportUnknownMemberType]
        encoding="utf-8", errors="replace"
    )


# =========================================================
# LOAD ML MODEL
# =========================================================

try:
    model_path = Path(__file__).resolve().parent / "Mental_Health_Model.pkl"
    model = joblib.load(model_path)  # pyright: ignore[reportUnknownMemberType]
    print("Mental Health ML model loaded successfully.")

except Exception as e:
    print("Failed to load Mental_Health_Model.pkl")
    print(f"Error: {e}")
    raise


# =========================================================
# COUNTRY CONFIGURATION
# =========================================================

top_countries = [
    "Other",
    "India",
    "USA",
    "Canada",
    "Australia",
    "UK",
    "Germany",
    "Mexico",
    "Turkey",
    "France"
]


# Create case-insensitive country lookup
country_lookup = {
    country.lower(): country
    for country in top_countries
}


# =========================================================
# FASTAPI APPLICATION
# =========================================================

app = FastAPI(
    title="Mental Health Prediction API",
    description=(
        "Machine Learning API for predicting a student's "
        "mental health score based on social media usage, "
        "academic behaviour, lifestyle and stress level."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)


# =========================================================
# CORS CONFIGURATION
# =========================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev server (MindScore AI)
        "http://127.0.0.1:5173",
        "http://localhost:4173",   # Vite production preview (`vite preview`)
        "http://127.0.0.1:4173",
        "https://themobasshirrahman.github.io",  # MindScore AI on GitHub Pages
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================================================
# FRONTEND (served same-origin to avoid CORS preflights)
# =========================================================

frontend_dir = Path(__file__).resolve().parent / "frontend"
app.mount("/app", StaticFiles(directory=frontend_dir, html=True), name="frontend")

# =========================================================
# INPUT DATA MODEL
# =========================================================

class Stress_Level(str, Enum):
    """Stress categories accepted by the API and ML model."""

    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"
    VERY_HIGH = "Very High"

    def __str__(self) -> str:
        return self.value

    @classmethod
    def values(cls) -> tuple[str, ...]:
        """Return the categories in their defined order."""
        return tuple(level.value for level in cls)

class StudentData(BaseModel):

    #  Basic Information
    

    Age: int = Field(
        ...,
        ge=18,
        le=24,
        description="Student age"
    )

    Gender: Literal[
        "Male",
        "Female"
    ]

    Country: str = Field(
        ...,
        min_length=1,
        description="Student's country"
    )

    Academic_Level: Literal[
        "High School",
        "Undergraduate",
        "Graduate",
        "Postgraduate"
    ]

    # Social Media Information-------

    Most_Used_Platform: Literal[
        "Facebook",
        "LinkedIn",
        "Instagram",
        "Snapchat",
        "Twitter",
        "YouTube",
        "TikTok",
        "LINE",
        "KakaoTalk",
        "VKontakte",
        "WhatsApp",
        "WeChat"
    ]

    Purpose_Of_Use: Literal[
        "Networking",
        "Education",
        "Entertainment",
        "News"
    ]

    #  Usage Behaviour

    Avg_Daily_Usage_Hours: float = Field(
        ...,
        ge=1,
        le=8.8,
        description="Average daily social media usage in hours"
    )

    Daily_Unlocks: int = Field(
        ...,
        ge=62,
        le=273,
        description="Number of phone/social media unlocks per day"
    )
    
    #  Academic Behaviour
    

    Study_Hours: float = Field(
        ...,
        ge=0.3,
        le=8.3,
        description="Daily study hours"
    )

    #  Lifestyle
    

    Physical_Activity_Hours: float = Field(
        ...,
        ge=0,
        le=4.1,
        description="Daily physical activity hours"
    )

    Sleep_Hours_Per_Night: float = Field(
        ...,
        ge=3.6,
        le=9.9,
        description="Average sleep hours per night"
    )

    # Stress ---
    Stress_Level: Stress_Level

# RESPONSE MODEL

class PredictionResponse(BaseModel):

    predicted_mental_health_score: float


# =========================================================
# HOME ENDPOINT
# =========================================================

@app.get("/")
def greet():

    return {
        "message": "Welcome to Mobasshir Mental Health Prediction API",
        "status": "running",
        "docs": "/docs"
    }


# =========================================================
# HEALTH CHECK
# =========================================================

@app.get("/health")
def health_check() -> dict[str, str | bool]:

    return {
        "status": "healthy",
        "model_loaded": True
    }


# =========================================================
# PREDICTION ENDPOINT
# =========================================================

@app.post(
    "/predict",
    response_model=PredictionResponse
)
def predict(data: StudentData):

    try:

        # -------------------------------------------------
        # Normalize country
        # -------------------------------------------------

        country_key = data.Country.strip().lower()

        country_group = country_lookup.get(
            country_key,
            "Other"
        )


        # -------------------------------------------------
        # Create model input
        #
        # IMPORTANT:
        # Country itself is NOT sent to the model.
        # The trained model uses Grouped_Country.
        # -------------------------------------------------

        input_row = pd.DataFrame([
            {
                "Age": data.Age,

                "Gender": data.Gender,

                "Academic_Level": data.Academic_Level,

                "Most_Used_Platform": data.Most_Used_Platform,

                "Purpose_Of_Use": data.Purpose_Of_Use,

                "Avg_Daily_Usage_Hours":
                    data.Avg_Daily_Usage_Hours,

                "Daily_Unlocks":
                    data.Daily_Unlocks,

                "Study_Hours":
                    data.Study_Hours,

                "Physical_Activity_Hours":
                    data.Physical_Activity_Hours,

                "Sleep_Hours_Per_Night":
                    data.Sleep_Hours_Per_Night,

                "Stress_Level":
                    data.Stress_Level.value,

                "Grouped_Country":
                    country_group
            }
        ])


        # -------------------------------------------------
        # Make prediction
        # -------------------------------------------------

        prediction = model.predict(input_row)[0]


        # -------------------------------------------------
        # Return response
        # -------------------------------------------------

        return PredictionResponse(
            predicted_mental_health_score=round(
                float(prediction),
                2
            )
        )


    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=f"Prediction failed: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)