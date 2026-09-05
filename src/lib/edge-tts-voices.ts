
export interface EdgeVoiceInfo {
  language: string;
  voices: {
    id: string; // e.g., af-ZA-AdriNeural
    name: string; // e.g., Adri (Female)
  }[];
}

export const edgeTTSLanguageVoices: Record<string, EdgeVoiceInfo> = {
    'af-ZA': {
        language: 'Afrikaans (South Africa)',
        voices: [
            { id: 'af-ZA-AdriNeural', name: 'Adri (Female)' },
            { id: 'af-ZA-WillemNeural', name: 'Willem (Male)' },
        ],
    },
    'am-ET': {
        language: 'Amharic (Ethiopia)',
        voices: [
            { id: 'am-ET-AmehaNeural', name: 'Ameha (Male)' },
            { id: 'am-ET-MekdesNeural', name: 'Mekdes (Female)' },
        ],
    },
    'ar-AE': {
        language: 'Arabic (United Arab Emirates)',
        voices: [
            { id: 'ar-AE-FatimaNeural', name: 'Fatima (Female)' },
            { id: 'ar-AE-HamdanNeural', name: 'Hamdan (Male)' },
        ],
    },
    'ar-BH': {
        language: 'Arabic (Bahrain)',
        voices: [
            { id: 'ar-BH-AliNeural', name: 'Ali (Male)' },
            { id: 'ar-BH-LailaNeural', name: 'Laila (Female)' },
        ],
    },
    'ar-DZ': {
        language: 'Arabic (Algeria)',
        voices: [
            { id: 'ar-DZ-AminaNeural', name: 'Amina (Female)' },
            { id: 'ar-DZ-IsmaelNeural', name: 'Ismael (Male)' },
        ],
    },
    'ar-EG': {
        language: 'Arabic (Egypt)',
        voices: [
            { id: 'ar-EG-SalmaNeural', name: 'Salma (Female)' },
            { id: 'ar-EG-ShakirNeural', name: 'Shakir (Male)' },
        ],
    },
    'ar-IQ': {
        language: 'Arabic (Iraq)',
        voices: [
            { id: 'ar-IQ-BasselNeural', name: 'Bassel (Male)' },
            { id: 'ar-IQ-RanaNeural', name: 'Rana (Female)' },
        ],
    },
    'ar-JO': {
        language: 'Arabic (Jordan)',
        voices: [
            { id: 'ar-JO-SanaNeural', name: 'Sana (Female)' },
            { id: 'ar-JO-TaimNeural', name: 'Taim (Male)' },
        ],
    },
    'ar-KW': {
        language: 'Arabic (Kuwait)',
        voices: [
            { id: 'ar-KW-FahedNeural', name: 'Fahed (Male)' },
            { id: 'ar-KW-NouraNeural', name: 'Noura (Female)' },
        ],
    },
    'ar-LB': {
        language: 'Arabic (Lebanon)',
        voices: [
            { id: 'ar-LB-LaylaNeural', name: 'Layla (Female)' },
            { id: 'ar-LB-RamiNeural', name: 'Rami (Male)' },
        ],
    },
    'ar-LY': {
        language: 'Arabic (Libya)',
        voices: [
            { id: 'ar-LY-ImanNeural', name: 'Iman (Female)' },
            { id: 'ar-LY-OmarNeural', name: 'Omar (Male)' },
        ],
    },
    'ar-MA': {
        language: 'Arabic (Morocco)',
        voices: [
            { id: 'ar-MA-JamalNeural', name: 'Jamal (Male)' },
            { id: 'ar-MA-MounaNeural', name: 'Mouna (Female)' },
        ],
    },
    'ar-OM': {
        language: 'Arabic (Oman)',
        voices: [
            { id: 'ar-OM-AbdullahNeural', name: 'Abdullah (Male)' },
            { id: 'ar-OM-AyshaNeural', name: 'Aysha (Female)' },
        ],
    },
    'ar-QA': {
        language: 'Arabic (Qatar)',
        voices: [
            { id: 'ar-QA-AmalNeural', name: 'Amal (Female)' },
            { id: 'ar-QA-MoazNeural', name: 'Moaz (Male)' },
        ],
    },
    'ar-SA': {
        language: 'Arabic (Saudi Arabia)',
        voices: [
            { id: 'ar-SA-HamedNeural', name: 'Hamed (Male)' },
            { id: 'ar-SA-ZariyahNeural', name: 'Zariyah (Female)' },
        ],
    },
    'ar-SY': {
        language: 'Arabic (Syria)',
        voices: [
            { id: 'ar-SY-AmanyNeural', name: 'Amany (Female)' },
            { id: 'ar-SY-LaithNeural', name: 'Laith (Male)' },
        ],
    },
    'ar-TN': {
        language: 'Arabic (Tunisia)',
        voices: [
            { id: 'ar-TN-HediNeural', name: 'Hedi (Male)' },
            { id: 'ar-TN-ReemNeural', name: 'Reem (Female)' },
        ],
    },
    'ar-YE': {
        language: 'Arabic (Yemen)',
        voices: [
            { id: 'ar-YE-MaryamNeural', name: 'Maryam (Female)' },
            { id: 'ar-YE-SalehNeural', name: 'Saleh (Male)' },
        ],
    },
    'az-AZ': {
        language: 'Azerbaijani (Latin, Azerbaijan)',
        voices: [
            { id: 'az-AZ-BabekNeural', name: 'Babek (Male)' },
            { id: 'az-AZ-BanuNeural', name: 'Banu (Female)' },
        ],
    },
    'bg-BG': {
        language: 'Bulgarian (Bulgaria)',
        voices: [
            { id: 'bg-BG-BorislavNeural', name: 'Borislav (Male)' },
            { id: 'bg-BG-KalinaNeural', name: 'Kalina (Female)' },
        ],
    },
    'bn-BD': {
        language: 'Bangla (Bangladesh)',
        voices: [
            { id: 'bn-BD-NabanitaNeural', name: 'Nabanita (Female)' },
            { id: 'bn-BD-PradeepNeural', name: 'Pradeep (Male)' },
        ],
    },
    'bn-IN': {
        language: 'Bengali (India)',
        voices: [
            { id: 'bn-IN-BashkarNeural', name: 'Bashkar (Male)' },
            { id: 'bn-IN-TanishaNeural', name: 'Tanisha (Female)' },
        ],
    },
    'bs-BA': {
        language: 'Bosnian (Bosnia and Herzegovina)',
        voices: [
            { id: 'bs-BA-GoranNeural', name: 'Goran (Male)' },
            { id: 'bs-BA-VesnaNeural', name: 'Vesna (Female)' },
        ],
    },
    'ca-ES': {
        language: 'Catalan (Spain)',
        voices: [
            { id: 'ca-ES-EnricNeural', name: 'Enric (Male)' },
            { id: 'ca-ES-JoanaNeural', name: 'Joana (Female)' },
        ],
    },
    'cs-CZ': {
        language: 'Czech (Czech Republic)',
        voices: [
            { id: 'cs-CZ-AntoninNeural', name: 'Antonin (Male)' },
            { id: 'cs-CZ-VlastaNeural', name: 'Vlasta (Female)' },
        ],
    },
    'cy-GB': {
        language: 'Welsh (United Kingdom)',
        voices: [
            { id: 'cy-GB-AledNeural', name: 'Aled (Male)' },
            { id: 'cy-GB-NiaNeural', name: 'Nia (Female)' },
        ],
    },
    'da-DK': {
        language: 'Danish (Denmark)',
        voices: [
            { id: 'da-DK-ChristelNeural', name: 'Christel (Female)' },
            { id: 'da-DK-JeppeNeural', name: 'Jeppe (Male)' },
        ],
    },
    'de-AT': {
        language: 'German (Austria)',
        voices: [
            { id: 'de-AT-IngridNeural', name: 'Ingrid (Female)' },
            { id: 'de-AT-JonasNeural', name: 'Jonas (Male)' },
        ],
    },
    'de-CH': {
        language: 'German (Switzerland)',
        voices: [
            { id: 'de-CH-JanNeural', name: 'Jan (Male)' },
            { id: 'de-CH-LeniNeural', name: 'Leni (Female)' },
        ],
    },
    'de-DE': {
        language: 'German (Germany)',
        voices: [
            { id: 'de-DE-AmalaNeural', name: 'Amala (Female)' },
            { id: 'de-DE-ConradNeural', name: 'Conrad (Male)' },
            { id: 'de-DE-KatjaNeural', name: 'Katja (Female)' },
            { id: 'de-DE-KillianNeural', name: 'Killian (Male)' },
        ],
    },
    'el-GR': {
        language: 'Greek (Greece)',
        voices: [
            { id: 'el-GR-AthinaNeural', name: 'Athina (Female)' },
            { id: 'el-GR-NestorasNeural', name: 'Nestoras (Male)' },
        ],
    },
    'en-AU': {
        language: 'English (Australia)',
        voices: [
            { id: 'en-AU-NatashaNeural', name: 'Natasha (Female)' },
            { id: 'en-AU-WilliamNeural', name: 'William (Male)' },
        ],
    },
    'en-CA': {
        language: 'English (Canada)',
        voices: [
            { id: 'en-CA-ClaraNeural', name: 'Clara (Female)' },
            { id: 'en-CA-LiamNeural', name: 'Liam (Male)' },
        ],
    },
    'en-GB': {
        language: 'English (United Kingdom)',
        voices: [
            { id: 'en-GB-LibbyNeural', name: 'Libby (Female)' },
            { id: 'en-GB-MaisieNeural', name: 'Maisie (Female)' },
            { id: 'en-GB-RyanNeural', name: 'Ryan (Male)' },
            { id: 'en-GB-SoniaNeural', name: 'Sonia (Female)' },
            { id: 'en-GB-ThomasNeural', name: 'Thomas (Male)' },
        ],
    },
    'en-HK': {
        language: 'English (Hong Kong)',
        voices: [
            { id: 'en-HK-SamNeural', name: 'Sam (Male)' },
            { id: 'en-HK-YanNeural', name: 'Yan (Female)' },
        ],
    },
    'en-IE': {
        language: 'English (Ireland)',
        voices: [
            { id: 'en-IE-ConnorNeural', name: 'Connor (Male)' },
            { id: 'en-IE-EmilyNeural', name: 'Emily (Female)' },
        ],
    },
    'en-IN': {
        language: 'English (India)',
        voices: [
            { id: 'en-IN-NeerjaNeural', name: 'Neerja (Female)' },
            { id: 'en-IN-PrabhatNeural', name: 'Prabhat (Male)' },
        ],
    },
    'en-KE': {
        language: 'English (Kenya)',
        voices: [
            { id: 'en-KE-AsiliaNeural', name: 'Asilia (Female)' },
            { id: 'en-KE-ChilembaNeural', name: 'Chilemba (Male)' },
        ],
    },
    'en-NG': {
        language: 'English (Nigeria)',
        voices: [
            { id: 'en-NG-AbeoNeural', name: 'Abeo (Male)' },
            { id: 'en-NG-EzinneNeural', name: 'Ezinne (Female)' },
        ],
    },
    'en-NZ': {
        language: 'English (New Zealand)',
        voices: [
            { id: 'en-NZ-MitchellNeural', name: 'Mitchell (Male)' },
            { id: 'en-NZ-MollyNeural', name: 'Molly (Female)' },
        ],
    },
    'en-PH': {
        language: 'English (Philippines)',
        voices: [
            { id: 'en-PH-JamesNeural', name: 'James (Male)' },
            { id: 'en-PH-RosaNeural', name: 'Rosa (Female)' },
        ],
    },
    'en-SG': {
        language: 'English (Singapore)',
        voices: [
            { id: 'en-SG-LunaNeural', name: 'Luna (Female)' },
            { id: 'en-SG-WayneNeural', name: 'Wayne (Male)' },
        ],
    },
    'en-TZ': {
        language: 'English (Tanzania)',
        voices: [
            { id: 'en-TZ-ElimuNeural', name: 'Elimu (Male)' },
            { id: 'en-TZ-ImaniNeural', name: 'Imani (Female)' },
        ],
    },
    'en-US': {
        language: 'English (United States)',
        voices: [
            { id: 'en-US-AriaNeural', name: 'Aria (Female)' },
            { id: 'en-US-AnaNeural', name: 'Ana (Female)' },
            { id: 'en-US-ChristopherNeural', name: 'Christopher (Male)' },
            { id: 'en-US-EricNeural', name: 'Eric (Male)' },
            { id: 'en-US-GuyNeural', name: 'Guy (Male)' },
            { id: 'en-US-JennyNeural', name: 'Jenny (Female)' },
            { id: 'en-US-MichelleNeural', name: 'Michelle (Female)' },
            { id: 'en-US-RogerNeural', name: 'Roger (Male)' },
            { id: 'en-US-SteffanNeural', name: 'Steffan (Male)' },
        ],
    },
    'en-ZA': {
        language: 'English (South Africa)',
        voices: [
            { id: 'en-ZA-LeahNeural', name: 'Leah (Female)' },
            { id: 'en-ZA-LukeNeural', name: 'Luke (Male)' },
        ],
    },
    'es-AR': {
        language: 'Spanish (Argentina)',
        voices: [
            { id: 'es-AR-ElenaNeural', name: 'Elena (Female)' },
            { id: 'es-AR-TomasNeural', name: 'Tomas (Male)' },
        ],
    },
    'es-BO': {
        language: 'Spanish (Bolivia)',
        voices: [
            { id: 'es-BO-MarceloNeural', name: 'Marcelo (Male)' },
            { id: 'es-BO-SofiaNeural', name: 'Sofia (Female)' },
        ],
    },
    'es-CL': {
        language: 'Spanish (Chile)',
        voices: [
            { id: 'es-CL-CatalinaNeural', name: 'Catalina (Female)' },
            { id: 'es-CL-LorenzoNeural', name: 'Lorenzo (Male)' },
        ],
    },
    'es-CO': {
        language: 'Spanish (Colombia)',
        voices: [
            { id: 'es-CO-GonzaloNeural', name: 'Gonzalo (Male)' },
            { id: 'es-CO-SalomeNeural', name: 'Salome (Female)' },
        ],
    },
    'es-CR': {
        language: 'Spanish (Costa Rica)',
        voices: [
            { id: 'es-CR-JuanNeural', name: 'Juan (Male)' },
            { id: 'es-CR-MariaNeural', name: 'Maria (Female)' },
        ],
    },
    'es-CU': {
        language: 'Spanish (Cuba)',
        voices: [
            { id: 'es-CU-BelkysNeural', name: 'Belkys (Female)' },
            { id: 'es-CU-ManuelNeural', name: 'Manuel (Male)' },
        ],
    },
    'es-DO': {
        language: 'Spanish (Dominican Republic)',
        voices: [
            { id: 'es-DO-EmilioNeural', name: 'Emilio (Male)' },
            { id: 'es-DO-RamonaNeural', name: 'Ramona (Female)' },
        ],
    },
    'es-EC': {
        language: 'Spanish (Ecuador)',
        voices: [
            { id: 'es-EC-AndreaNeural', name: 'Andrea (Female)' },
            { id: 'es-EC-LuisNeural', name: 'Luis (Male)' },
        ],
    },
    'es-ES': {
        language: 'Spanish (Spain)',
        voices: [
            { id: 'es-ES-AlvaroNeural', name: 'Alvaro (Male)' },
            { id: 'es-ES-ElviraNeural', name: 'Elvira (Female)' },
        ],
    },
    'es-GQ': {
        language: 'Spanish (Equatorial Guinea)',
        voices: [
            { id: 'es-GQ-TeresaNeural', name: 'Teresa (Female)' },
            { id: 'es-GQ-EmilioNeural', name: 'Emilio (Male)' },
        ],
    },
    'es-GT': {
        language: 'Spanish (Guatemala)',
        voices: [
            { id: 'es-GT-AndresNeural', name: 'Andres (Male)' },
            { id: 'es-GT-MartaNeural', name: 'Marta (Female)' },
        ],
    },
    'es-HN': {
        language: 'Spanish (Honduras)',
        voices: [
            { id: 'es-HN-CarlosNeural', name: 'Carlos (Male)' },
            { id: 'es-HN-KarlaNeural', name: 'Karla (Female)' },
        ],
    },
    'es-MX': {
        language: 'Spanish (Mexico)',
        voices: [
            { id: 'es-MX-DaliaNeural', name: 'Dalia (Female)' },
            { id: 'es-MX-JorgeNeural', name: 'Jorge (Male)' },
        ],
    },
    'es-NI': {
        language: 'Spanish (Nicaragua)',
        voices: [
            { id: 'es-NI-FedericoNeural', name: 'Federico (Male)' },
            { id: 'es-NI-YolandaNeural', name: 'Yolanda (Female)' },
        ],
    },
    'es-PA': {
        language: 'Spanish (Panama)',
        voices: [
            { id: 'es-PA-MargaritaNeural', name: 'Margarita (Female)' },
            { id: 'es-PA-RobertoNeural', name: 'Roberto (Male)' },
        ],
    },
    'es-PE': {
        language: 'Spanish (Peru)',
        voices: [
            { id: 'es-PE-AlexNeural', name: 'Alex (Male)' },
            { id: 'es-PE-CamilaNeural', name: 'Camila (Female)' },
        ],
    },
    'es-PR': {
        language: 'Spanish (Puerto Rico)',
        voices: [
            { id: 'es-PR-KarinaNeural', name: 'Karina (Female)' },
            { id: 'es-PR-VictorNeural', name: 'Victor (Male)' },
        ],
    },
    'es-PY': {
        language: 'Spanish (Paraguay)',
        voices: [
            { id: 'es-PY-MarioNeural', name: 'Mario (Male)' },
            { id: 'es-PY-TaniaNeural', name: 'Tania (Female)' },
        ],
    },
    'es-SV': {
        language: 'Spanish (El Salvador)',
        voices: [
            { id: 'es-SV-LorenaNeural', name: 'Lorena (Female)' },
            { id: 'es-SV-RodrigoNeural', name: 'Rodrigo (Male)' },
        ],
    },
    'es-US': {
        language: 'Spanish (United States)',
        voices: [
            { id: 'es-US-AlonsoNeural', name: 'Alonso (Male)' },
            { id: 'es-US-PalomaNeural', name: 'Paloma (Female)' },
        ],
    },
    'es-UY': {
        language: 'Spanish (Uruguay)',
        voices: [
            { id: 'es-UY-MateoNeural', name: 'Mateo (Male)' },
            { id: 'es-UY-ValentinaNeural', name: 'Valentina (Female)' },
        ],
    },
    'es-VE': {
        language: 'Spanish (Venezuela)',
        voices: [
            { id: 'es-VE-PaolaNeural', name: 'Paola (Female)' },
            { id: 'es-VE-SebastianNeural', name: 'Sebastian (Male)' },
        ],
    },
    'et-EE': {
        language: 'Estonian (Estonia)',
        voices: [
            { id: 'et-EE-AnuNeural', name: 'Anu (Female)' },
            { id: 'et-EE-KertNeural', name: 'Kert (Male)' },
        ],
    },
    'eu-ES': {
        language: 'Basque (Spain)',
        voices: [
            { id: 'eu-ES-AinhoaNeural', name: 'Ainhoa (Female)' },
            { id: 'eu-ES-AnderNeural', name: 'Ander (Male)' },
        ],
    },
    'fa-IR': {
        language: 'Persian (Iran)',
        voices: [
            { id: 'fa-IR-DilaraNeural', name: 'Dilara (Female)' },
            { id: 'fa-IR-FaridNeural', name: 'Farid (Male)' },
        ],
    },
    'fi-FI': {
        language: 'Finnish (Finland)',
        voices: [
            { id: 'fi-FI-HarriNeural', name: 'Harri (Male)' },
            { id: 'fi-FI-NooraNeural', name: 'Noora (Female)' },
        ],
    },
    'fil-PH': {
        language: 'Filipino (Philippines)',
        voices: [
            { id: 'fil-PH-AngeloNeural', name: 'Angelo (Male)' },
            { id: 'fil-PH-BlessicaNeural', name: 'Blessica (Female)' },
        ],
    },
    'fr-BE': {
        language: 'French (Belgium)',
        voices: [
            { id: 'fr-BE-CharlineNeural', name: 'Charline (Female)' },
            { id: 'fr-BE-GerardNeural', name: 'Gerard (Male)' },
        ],
    },
    'fr-CA': {
        language: 'French (Canada)',
        voices: [
            { id: 'fr-CA-AntoineNeural', name: 'Antoine (Male)' },
            { id: 'fr-CA-JeanNeural', name: 'Jean (Male)' },
            { id: 'fr-CA-SylvieNeural', name: 'Sylvie (Female)' },
        ],
    },
    'fr-CH': {
        language: 'French (Switzerland)',
        voices: [
            { id: 'fr-CH-ArianeNeural', name: 'Ariane (Female)' },
            { id: 'fr-CH-FabriceNeural', name: 'Fabrice (Male)' },
        ],
    },
    'fr-FR': {
        language: 'French (France)',
        voices: [
            { id: 'fr-FR-DeniseNeural', name: 'Denise (Female)' },
            { id: 'fr-FR-EloiseNeural', name: 'Eloise (Female)' },
            { id: 'fr-FR-HenriNeural', name: 'Henri (Male)' },
        ],
    },
    'ga-IE': {
        language: 'Irish (Ireland)',
        voices: [
            { id: 'ga-IE-ColmNeural', name: 'Colm (Male)' },
            { id: 'ga-IE-OrlaNeural', name: 'Orla (Female)' },
        ],
    },
    'gl-ES': {
        language: 'Galician (Spain)',
        voices: [
            { id: 'gl-ES-RoiNeural', name: 'Roi (Male)' },
            { id: 'gl-ES-SabelaNeural', name: 'Sabela (Female)' },
        ],
    },
    'gu-IN': {
        language: 'Gujarati (India)',
        voices: [
            { id: 'gu-IN-DhwaniNeural', name: 'Dhwani (Female)' },
            { id: 'gu-IN-NiranjanNeural', name: 'Niranjan (Male)' },
        ],
    },
    'he-IL': {
        language: 'Hebrew (Israel)',
        voices: [
            { id: 'he-IL-AvriNeural', name: 'Avri (Male)' },
            { id: 'he-IL-HilaNeural', name: 'Hila (Female)' },
        ],
    },
    'hi-IN': {
        language: 'Hindi (India)',
        voices: [
            { id: 'hi-IN-MadhurNeural', name: 'Madhur (Male)' },
            { id: 'hi-IN-SwaraNeural', name: 'Swara (Female)' },
        ],
    },
    'hr-HR': {
        language: 'Croatian (Croatia)',
        voices: [
            { id: 'hr-HR-GabrijelaNeural', name: 'Gabrijela (Female)' },
            { id: 'hr-HR-SreckoNeural', name: 'Srecko (Male)' },
        ],
    },
    'hu-HU': {
        language: 'Hungarian (Hungary)',
        voices: [
            { id: 'hu-HU-NoemiNeural', name: 'Noemi (Female)' },
            { id: 'hu-HU-TamasNeural', name: 'Tamas (Male)' },
        ],
    },
    'hy-AM': {
        language: 'Armenian (Armenia)',
        voices: [
            { id: 'hy-AM-AnahitNeural', name: 'Anahit (Female)' },
            { id: 'hy-AM-HaykNeural', name: 'Hayk (Male)' },
        ],
    },
    'id-ID': {
        language: 'Indonesian (Indonesia)',
        voices: [
            { id: 'id-ID-ArdiNeural', name: 'Ardi (Male)' },
            { id: 'id-ID-GadisNeural', name: 'Gadis (Female)' },
        ],
    },
    'is-IS': {
        language: 'Icelandic (Iceland)',
        voices: [
            { id: 'is-IS-GudrunNeural', name: 'Gudrun (Female)' },
            { id: 'is-IS-GunnarNeural', name: 'Gunnar (Male)' },
        ],
    },
    'it-IT': {
        language: 'Italian (Italy)',
        voices: [
            { id: 'it-IT-DiegoNeural', name: 'Diego (Male)' },
            { id: 'it-IT-ElsaNeural', name: 'Elsa (Female)' },
            { id: 'it-IT-IsabellaNeural', name: 'Isabella (Female)' },
        ],
    },
    'ja-JP': {
        language: 'Japanese (Japan)',
        voices: [
            { id: 'ja-JP-KeitaNeural', name: 'Keita (Male)' },
            { id: 'ja-JP-NanamiNeural', name: 'Nanami (Female)' },
        ],
    },
    'jv-ID': {
        language: 'Javanese (Indonesia)',
        voices: [
            { id: 'jv-ID-DimasNeural', name: 'Dimas (Male)' },
            { id: 'jv-ID-SitiNeural', name: 'Siti (Female)' },
        ],
    },
    'ka-GE': {
        language: 'Georgian (Georgia)',
        voices: [
            { id: 'ka-GE-EkaNeural', name: 'Eka (Female)' },
            { id: 'ka-GE-GiorgiNeural', name: 'Giorgi (Male)' },
        ],
    },
    'kk-KZ': {
        language: 'Kazakh (Kazakhstan)',
        voices: [
            { id: 'kk-KZ-AigulNeural', name: 'Aigul (Female)' },
            { id: 'kk-KZ-DauletNeural', name: 'Daulet (Male)' },
        ],
    },
    'km-KH': {
        language: 'Khmer (Cambodia)',
        voices: [
            { id: 'km-KH-PisethNeural', name: 'Piseth (Male)' },
            { id: 'km-KH-SreymomNeural', name: 'Sreymom (Female)' },
        ],
    },
    'kn-IN': {
        language: 'Kannada (India)',
        voices: [
            { id: 'kn-IN-GaganNeural', name: 'Gagan (Male)' },
            { id: 'kn-IN-SapnaNeural', name: 'Sapna (Female)' },
        ],
    },
    'ko-KR': {
        language: 'Korean (Korea)',
        voices: [
            { id: 'ko-KR-InJoonNeural', name: 'InJoon (Male)' },
            { id: 'ko-KR-SunHiNeural', name: 'SunHi (Female)' },
        ],
    },
    'lo-LA': {
        language: 'Lao (Laos)',
        voices: [
            { id: 'lo-LA-ChanthavongNeural', name: 'Chanthavong (Male)' },
            { id: 'lo-LA-KeomanyNeural', name: 'Keomany (Female)' },
        ],
    },
    'lt-LT': {
        language: 'Lithuanian (Lithuania)',
        voices: [
            { id: 'lt-LT-LeonasNeural', name: 'Leonas (Male)' },
            { id: 'lt-LT-OnaNeural', name: 'Ona (Female)' },
        ],
    },
    'lv-LV': {
        language: 'Latvian (Latvia)',
        voices: [
            { id: 'lv-LV-EveritaNeural', name: 'Everita (Female)' },
            { id: 'lv-LV-NilsNeural', name: 'Nils (Male)' },
        ],
    },
    'mk-MK': {
        language: 'Macedonian (North Macedonia)',
        voices: [
            { id: 'mk-MK-AleksandarNeural', name: 'Aleksandar (Male)' },
            { id: 'mk-MK-MarijaNeural', name: 'Marija (Female)' },
        ],
    },
    'ml-IN': {
        language: 'Malayalam (India)',
        voices: [
            { id: 'ml-IN-MidhunNeural', name: 'Midhun (Male)' },
            { id: 'ml-IN-SobhanaNeural', name: 'Sobhana (Female)' },
        ],
    },
    'mn-MN': {
        language: 'Mongolian (Mongolia)',
        voices: [
            { id: 'mn-MN-BataaNeural', name: 'Bataa (Male)' },
            { id: 'mn-MN-YesuiNeural', name: 'Yesui (Female)' },
        ],
    },
    'ms-MY': {
        language: 'Malay (Malaysia)',
        voices: [
            { id: 'ms-MY-OsmanNeural', name: 'Osman (Male)' },
            { id: 'ms-MY-YasminNeural', name: 'Yasmin (Female)' },
        ],
    },
    'mt-MT': {
        language: 'Maltese (Malta)',
        voices: [
            { id: 'mt-MT-GraceNeural', name: 'Grace (Female)' },
            { id: 'mt-MT-JosephNeural', name: 'Joseph (Male)' },
        ],
    },
    'my-MM': {
        language: 'Burmese (Myanmar)',
        voices: [
            { id: 'my-MM-NilarNeural', name: 'Nilar (Female)' },
            { id: 'my-MM-ThihaNeural', name: 'Thiha (Male)' },
        ],
    },
    'nb-NO': {
        language: 'Norwegian Bokmål (Norway)',
        voices: [
            { id: 'nb-NO-FinnNeural', name: 'Finn (Male)' },
            { id: 'nb-NO-PernilleNeural', name: 'Pernille (Female)' },
        ],
    },
    'ne-NP': {
        language: 'Nepali (Nepal)',
        voices: [
            { id: 'ne-NP-HemkalaNeural', name: 'Hemkala (Female)' },
            { id: 'ne-NP-SagarNeural', name: 'Sagar (Male)' },
        ],
    },
    'nl-BE': {
        language: 'Dutch (Belgium)',
        voices: [
            { id: 'nl-BE-ArnaudNeural', name: 'Arnaud (Male)' },
            { id: 'nl-BE-DenaNeural', name: 'Dena (Female)' },
        ],
    },
    'nl-NL': {
        language: 'Dutch (Netherlands)',
        voices: [
            { id: 'nl-NL-ColetteNeural', name: 'Colette (Female)' },
            { id: 'nl-NL-FennaNeural', name: 'Fenna (Female)' },
            { id: 'nl-NL-MaartenNeural', name: 'Maarten (Male)' },
        ],
    },
    'pl-PL': {
        language: 'Polish (Poland)',
        voices: [
            { id: 'pl-PL-AgnieszkaNeural', name: 'Agnieszka (Female)' },
            { id: 'pl-PL-MarekNeural', name: 'Marek (Male)' },
        ],
    },
    'ps-AF': {
        language: 'Pashto (Afghanistan)',
        voices: [
            { id: 'ps-AF-GulNawaraNeural', name: 'Gul Nawara (Female)' },
            { id: 'ps-AF-LatifaNeural', name: 'Latifa (Male)' },
        ],
    },
    'pt-BR': {
        language: 'Portuguese (Brazil)',
        voices: [
            { id: 'pt-BR-AntonioNeural', name: 'Antonio (Male)' },
            { id: 'pt-BR-FranciscaNeural', name: 'Francisca (Female)' },
        ],
    },
    'pt-PT': {
        language: 'Portuguese (Portugal)',
        voices: [
            { id: 'pt-PT-DuarteNeural', name: 'Duarte (Male)' },
            { id: 'pt-PT-RaquelNeural', name: 'Raquel (Female)' },
        ],
    },
    'ro-RO': {
        language: 'Romanian (Romania)',
        voices: [
            { id: 'ro-RO-AlinaNeural', name: 'Alina (Female)' },
            { id: 'ro-RO-EmilNeural', name: 'Emil (Male)' },
        ],
    },
    'ru-RU': {
        language: 'Russian (Russia)',
        voices: [
            { id: 'ru-RU-DmitryNeural', name: 'Dmitry (Male)' },
            { id: 'ru-RU-SvetlanaNeural', name: 'Svetlana (Female)' },
        ],
    },
    'si-LK': {
        language: 'Sinhala (Sri Lanka)',
        voices: [
            { id: 'si-LK-SameeraNeural', name: 'Sameera (Male)' },
            { id: 'si-LK-ThiliniNeural', name: 'Thilini (Female)' },
        ],
    },
    'sk-SK': {
        language: 'Slovak (Slovakia)',
        voices: [
            { id: 'sk-SK-LukasNeural', name: 'Lukas (Male)' },
            { id: 'sk-SK-ViktoriaNeural', name: 'Viktoria (Female)' },
        ],
    },
    'sl-SI': {
        language: 'Slovenian (Slovenia)',
        voices: [
            { id: 'sl-SI-PetraNeural', name: 'Petra (Female)' },
            { id: 'sl-SI-RokNeural', name: 'Rok (Male)' },
        ],
    },
    'so-SO': {
        language: 'Somali (Somalia)',
        voices: [
            { id: 'so-SO-MuuseNeural', name: 'Muuse (Male)' },
            { id: 'so-SO-UbaxNeural', name: 'Ubax (Female)' },
        ],
    },
    'sq-AL': {
        language: 'Albanian (Albania)',
        voices: [
            { id: 'sq-AL-AnilaNeural', name: 'Anila (Female)' },
            { id: 'sq-AL-IlirNeural', name: 'Ilir (Male)' },
        ],
    },
    'sr-RS': {
        language: 'Serbian (Cyrillic, Serbia)',
        voices: [
            { id: 'sr-RS-NicholasNeural', name: 'Nicholas (Male)' },
            { id: 'sr-RS-SophieNeural', name: 'Sophie (Female)' },
        ],
    },
    'su-ID': {
        language: 'Sundanese (Indonesia)',
        voices: [
            { id: 'su-ID-JajangNeural', name: 'Jajang (Male)' },
            { id: 'su-ID-TutiNeural', name: 'Tuti (Female)' },
        ],
    },
    'sv-SE': {
        language: 'Swedish (Sweden)',
        voices: [
            { id: 'sv-SE-MattiasNeural', name: 'Mattias (Male)' },
            { id: 'sv-SE-SofieNeural', name: 'Sofie (Female)' },
        ],
    },
    'sw-KE': {
        language: 'Swahili (Kenya)',
        voices: [
            { id: 'sw-KE-RafikiNeural', name: 'Rafiki (Male)' },
            { id: 'sw-KE-ZuriNeural', name: 'Zuri (Female)' },
        ],
    },
    'sw-TZ': {
        language: 'Swahili (Tanzania)',
        voices: [
            { id: 'sw-TZ-DaudiNeural', name: 'Daudi (Male)' },
            { id: 'sw-TZ-RehemaNeural', name: 'Rehema (Female)' },
        ],
    },
    'ta-IN': {
        language: 'Tamil (India)',
        voices: [
            { id: 'ta-IN-PallaviNeural', name: 'Pallavi (Female)' },
            { id: 'ta-IN-ValluvarNeural', name: 'Valluvar (Male)' },
        ],
    },
    'ta-LK': {
        language: 'Tamil (Sri Lanka)',
        voices: [
            { id: 'ta-LK-KumarNeural', name: 'Kumar (Male)' },
            { id: 'ta-LK-SaranyaNeural', name: 'Saranya (Female)' },
        ],
    },
    'ta-MY': {
        language: 'Tamil (Malaysia)',
        voices: [
            { id: 'ta-MY-KaniNeural', name: 'Kani (Female)' },
            { id: 'ta-MY-SuryaNeural', name: 'Surya (Male)' },
        ],
    },
    'ta-SG': {
        language: 'Tamil (Singapore)',
        voices: [
            { id: 'ta-SG-AnbuNeural', name: 'Anbu (Male)' },
            { id: 'ta-SG-VenbaNeural', name: 'Venba (Female)' },
        ],
    },
    'te-IN': {
        language: 'Telugu (India)',
        voices: [
            { id: 'te-IN-MohanNeural', name: 'Mohan (Male)' },
            { id: 'te-IN-ShrutiNeural', name: 'Shruti (Female)' },
        ],
    },
    'th-TH': {
        language: 'Thai (Thailand)',
        voices: [
            { id: 'th-TH-NiwatNeural', name: 'Niwat (Male)' },
            { id: 'th-TH-PremwadeeNeural', name: 'Premwadee (Female)' },
        ],
    },
    'tr-TR': {
        language: 'Turkish (Turkey)',
        voices: [
            { id: 'tr-TR-AhmetNeural', name: 'Ahmet (Male)' },
            { id: 'tr-TR-EmelNeural', name: 'Emel (Female)' },
        ],
    },
    'uk-UA': {
        language: 'Ukrainian (Ukraine)',
        voices: [
            { id: 'uk-UA-OstapNeural', name: 'Ostap (Male)' },
            { id: 'uk-UA-PolinaNeural', name: 'Polina (Female)' },
        ],
    },
    'ur-IN': {
        language: 'Urdu (India)',
        voices: [
            { id: 'ur-IN-GulNeural', name: 'Gul (Female)' },
            { id: 'ur-IN-SalmanNeural', name: 'Salman (Male)' },
        ],
    },
    'ur-PK': {
        language: 'Urdu (Pakistan)',
        voices: [
            { id: 'ur-PK-AsadNeural', name: 'Asad (Male)' },
            { id: 'ur-PK-UzmaNeural', name: 'Uzma (Female)' },
        ],
    },
    'uz-UZ': {
        language: 'Uzbek (Latin, Uzbekistan)',
        voices: [
            { id: 'uz-UZ-MadinaNeural', name: 'Madina (Female)' },
            { id: 'uz-UZ-SardorNeural', name: 'Sardor (Male)' },
        ],
    },
    'vi-VN': {
        language: 'Vietnamese (Vietnam)',
        voices: [
            { id: 'vi-VN-HoaiMyNeural', name: 'HoaiMy (Female)' },
            { id: 'vi-VN-NamMinhNeural', name: 'NamMinh (Male)' },
        ],
    },
    'zh-CN': {
        language: 'Chinese (Mandarin, Simplified)',
        voices: [
            { id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao (Female)' },
            { id: 'zh-CN-YunyangNeural', name: 'Yunyang (Male)' },
            { id: 'zh-CN-XiaoyiNeural', name: 'Xiaoyi (Female)' },
            { id: 'zh-CN-YunjianNeural', name: 'Yunjian (Male)' },
            { id: 'zh-CN-YunxiaNeural', name: 'Yunxia (Male)' },
            { id: 'zh-CN-liaoning-XiaobeiNeural', name: 'Xiaobei (Female, Liaoning)' },
            { id: 'zh-CN-shaanxi-XiaoniNeural', name: 'Xiaoni (Female, Shaanxi)' },
        ],
    },
    'zh-HK': {
        language: 'Chinese (Cantonese, Traditional)',
        voices: [
            { id: 'zh-HK-HiuGaaiNeural', name: 'HiuGaai (Female)' },
            { id: 'zh-HK-HiuMaanNeural', name: 'HiuMaan (Female)' },
            { id: 'zh-HK-WanLungNeural', name: 'WanLung (Male)' },
        ],
    },
    'zh-TW': {
        language: 'Chinese (Taiwanese Mandarin, Traditional)',
        voices: [
            { id: 'zh-TW-HsiaoChenNeural', name: 'HsiaoChen (Female)' },
            { id: 'zh-TW-HsiaoYuNeural', name: 'HsiaoYu (Female)' },
            { id: 'zh-TW-YunJheNeural', name: 'YunJhe (Male)' },
        ],
    },
    'zu-ZA': {
        language: 'Zulu (South Africa)',
        voices: [
            { id: 'zu-ZA-ThandoNeural', name: 'Thando (Female)' },
            { id: 'zu-ZA-ThembaNeural', name: 'Themba (Male)' },
        ],
    },
};
