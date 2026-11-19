import json, sys, wave
import numpy as np
from faster_whisper import WhisperModel
model = WhisperModel('base', device='cpu', compute_type='int8', cpu_threads=4)
with wave.open(sys.argv[1], 'rb') as audio_file:
    audio = np.frombuffer(audio_file.readframes(audio_file.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
segments, info = model.transcribe(audio, beam_size=3, word_timestamps=True, vad_filter=True, condition_on_previous_text=False)
words=[]
for segment in segments:
    if segment.no_speech_prob > .75: continue
    for w in segment.words or []:
        if w.word.strip(): words.append({'text':w.word.strip(),'start':round(w.start,3),'end':round(w.end,3)})
with open(sys.argv[2],'w') as f: json.dump({'language':info.language,'words':words},f)
