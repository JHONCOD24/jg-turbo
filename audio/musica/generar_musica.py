import math
import struct
import subprocess
import os
import wave

SAMPLE_RATE = 44100
CROSSFADE_SEC = 1.0

def equal_power_crossfade(samples, crossfade_len):
    total = len(samples)
    loop_len = total - crossfade_len
    out = [0.0] * loop_len
    
    # Body
    for i in range(loop_len):
        out[i] = samples[i]
        
    # Crossfade head and tail
    for i in range(crossfade_len):
        tail_idx = loop_len + i
        t = i / float(crossfade_len)
        gain_tail = math.cos(t * math.pi * 0.5)
        gain_head = math.sin(t * math.pi * 0.5)
        out[i] = out[i] * gain_head + samples[tail_idx] * gain_tail
        
    return out

def save_wav_and_encode_mp3(left, right, wav_path, mp3_path):
    n = len(left)
    peak = max(max(abs(x) for x in left), max(abs(x) for x in right), 0.001)
    scale = 0.84 / peak
    
    with wave.open(wav_path, 'wb') as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        raw = bytearray(n * 4)
        for i in range(n):
            l = int(max(-32767, min(32767, left[i] * scale * 32767)))
            r = int(max(-32767, min(32767, right[i] * scale * 32767)))
            struct.pack_into('<hh', raw, i * 4, l, r)
        wf.writeframes(raw)
        
    cmd = [
        'ffmpeg', '-y', '-i', wav_path,
        '-codec:a', 'libmp3lame', '-b:a', '128k',
        mp3_path
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if os.path.exists(wav_path):
        os.remove(wav_path)
    print(f"Generated {mp3_path} ({os.path.getsize(mp3_path)} bytes)")

# 1. Concentración 1: Pulso Alfa (68 BPM)
def gen_concentracion_1(output_mp3):
    bpm = 68.0
    spb = 60.0 / bpm
    total_beats = 16
    loop_duration = total_beats * spb # ~14.117s
    total_sec = loop_duration + CROSSFADE_SEC
    total_samples = int(total_sec * SAMPLE_RATE)
    
    left = [0.0] * total_samples
    right = [0.0] * total_samples
    
    chords = [
        [146.83, 174.61, 220.00, 261.63, 329.63], # Dm9
        [98.00,  174.61, 246.94, 329.63, 392.00], # G13
        [130.81, 164.81, 196.00, 246.94, 293.66], # Cmaj9
        [110.00, 196.00, 261.63, 329.63, 493.88], # Am9
    ]
    
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        beat = (t / spb) % total_beats
        chord_idx = int(beat // 4) % len(chords)
        chord = chords[chord_idx]
        
        val_l = 0.0
        val_r = 0.0
        for fi, freq in enumerate(chord):
            detune = 1.0 + 0.0012 * math.sin(t * 0.3 + fi)
            w1 = 2 * math.pi * freq * t
            chord_t = (beat % 4) * spb
            env = 1.0 - 0.25 * math.exp(-chord_t * 1.5)
            harmonic = math.sin(w1) * 0.6 + math.sin(w1 * 2) * 0.18 + math.sin(w1 * 3) * 0.06
            pan = 0.5 + 0.25 * math.sin(fi * 1.3 + t * 0.2)
            val_l += harmonic * (1.0 - pan) * env
            val_r += harmonic * pan * env
            
        binaural_carrier = 216.0
        binaural_beat = 10.0
        val_l += 0.22 * math.sin(2 * math.pi * binaural_carrier * t)
        val_r += 0.22 * math.sin(2 * math.pi * (binaural_carrier + binaural_beat) * t)
        
        left[i] = val_l
        right[i] = val_r
        
    cf_samples = int(CROSSFADE_SEC * SAMPLE_RATE)
    final_l = equal_power_crossfade(left, cf_samples)
    final_r = equal_power_crossfade(right, cf_samples)
    save_wav_and_encode_mp3(final_l, final_r, output_mp3 + '.wav', output_mp3)

# 2. Concentración 2: Flujo Continuo (72 BPM)
def gen_concentracion_2(output_mp3):
    bpm = 72.0
    spb = 60.0 / bpm
    total_beats = 16
    loop_duration = total_beats * spb # ~13.33s
    total_sec = loop_duration + CROSSFADE_SEC
    total_samples = int(total_sec * SAMPLE_RATE)
    
    left = [0.0] * total_samples
    right = [0.0] * total_samples
    
    pad_freqs = [110.0, 164.81, 220.0, 277.18, 329.63]
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        val_l = 0.0
        val_r = 0.0
        for fi, freq in enumerate(pad_freqs):
            phase = 2 * math.pi * freq * t
            tremolo = 0.8 + 0.2 * math.sin(t * 1.2 + fi)
            s = math.sin(phase) + 0.3 * math.sin(phase * 2) + 0.1 * math.sin(phase * 3)
            val_l += s * tremolo * (0.4 + 0.2 * math.cos(t * 0.4 + fi))
            val_r += s * tremolo * (0.4 + 0.2 * math.sin(t * 0.4 + fi))
            
        noise = (math.sin(i * 12.9898 + t * 45.3) * 43758.5453) % 1.0 - 0.5
        val_l += noise * 0.015
        val_r += noise * 0.015
        left[i] = val_l
        right[i] = val_r
        
    cf_samples = int(CROSSFADE_SEC * SAMPLE_RATE)
    final_l = equal_power_crossfade(left, cf_samples)
    final_r = equal_power_crossfade(right, cf_samples)
    save_wav_and_encode_mp3(final_l, final_r, output_mp3 + '.wav', output_mp3)

# 3. Relax 1: Ondas de Calma (60 BPM)
def gen_relax_1(output_mp3):
    loop_duration = 16.0
    total_sec = loop_duration + CROSSFADE_SEC
    total_samples = int(total_sec * SAMPLE_RATE)
    left = [0.0] * total_samples
    right = [0.0] * total_samples
    
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        cycle = (t % 8.0) / 8.0
        is_first = (t % 16.0) < 8.0
        freqs = [87.31, 130.81, 220.00, 329.63] if is_first else [116.54, 174.61, 293.66, 440.00]
        
        env = math.sin(cycle * math.pi)
        val_l = 0.0
        val_r = 0.0
        for fi, f in enumerate(freqs):
            detune = 1.0 + 0.0008 * math.sin(t * 0.5 + fi)
            w = 2 * math.pi * f * t
            s = math.sin(w) * 0.7 + math.sin(w * detune) * 0.5
            val_l += s * env * (0.6 + 0.2 * math.sin(t * 0.3 + fi))
            val_r += s * env * (0.6 + 0.2 * math.cos(t * 0.3 + fi))
            
        left[i] = val_l
        right[i] = val_r
        
    cf_samples = int(CROSSFADE_SEC * SAMPLE_RATE)
    final_l = equal_power_crossfade(left, cf_samples)
    final_r = equal_power_crossfade(right, cf_samples)
    save_wav_and_encode_mp3(final_l, final_r, output_mp3 + '.wav', output_mp3)

# 4. Relax 2: Serenidad Acústica
def gen_relax_2(output_mp3):
    loop_duration = 15.0
    total_sec = loop_duration + CROSSFADE_SEC
    total_samples = int(total_sec * SAMPLE_RATE)
    left = [0.0] * total_samples
    right = [0.0] * total_samples
    
    bell_freqs = [261.63, 329.63, 392.00, 523.25, 659.25]
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        val_l = 0.0
        val_r = 0.0
        
        pad = math.sin(2 * math.pi * 65.41 * t) * 0.5 + math.sin(2 * math.pi * 98.0 * t) * 0.35
        val_l += pad * 0.4
        val_r += pad * 0.4
        
        for bi, bf in enumerate(bell_freqs):
            bt = (t + bi * 3.0) % 15.0
            if bt < 4.0:
                decay = math.exp(-bt * 1.8)
                w = 2 * math.pi * bf * bt
                bell = (math.sin(w) + 0.25 * math.sin(w * 2.76) + 0.1 * math.sin(w * 5.4)) * decay
                pan = 0.2 + 0.6 * (bi / len(bell_freqs))
                val_l += bell * (1.0 - pan) * 0.35
                val_r += bell * pan * 0.35
                
        left[i] = val_l
        right[i] = val_r
        
    cf_samples = int(CROSSFADE_SEC * SAMPLE_RATE)
    final_l = equal_power_crossfade(left, cf_samples)
    final_r = equal_power_crossfade(right, cf_samples)
    save_wav_and_encode_mp3(final_l, final_r, output_mp3 + '.wav', output_mp3)

# 5. Noche 1: Penumbra Serena
def gen_noche_1(output_mp3):
    loop_duration = 16.0
    total_sec = loop_duration + CROSSFADE_SEC
    total_samples = int(total_sec * SAMPLE_RATE)
    left = [0.0] * total_samples
    right = [0.0] * total_samples
    
    freqs = [55.0, 82.41, 110.0, 164.81]
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        val_l = 0.0
        val_r = 0.0
        pulse = 0.75 + 0.25 * math.sin(2 * math.pi * (1.0 / 8.0) * t)
        for fi, f in enumerate(freqs):
            w = 2 * math.pi * f * t
            s = math.sin(w) * (1.0 / (fi + 1))
            val_l += s * pulse * (0.5 + 0.15 * math.sin(t * 0.2 + fi))
            val_r += s * pulse * (0.5 + 0.15 * math.cos(t * 0.2 + fi))
            
        left[i] = val_l
        right[i] = val_r
        
    cf_samples = int(CROSSFADE_SEC * SAMPLE_RATE)
    final_l = equal_power_crossfade(left, cf_samples)
    final_r = equal_power_crossfade(right, cf_samples)
    save_wav_and_encode_mp3(final_l, final_r, output_mp3 + '.wav', output_mp3)

# 6. Noche 2: Nebulosa Estelar
def gen_noche_2(output_mp3):
    loop_duration = 16.0
    total_sec = loop_duration + CROSSFADE_SEC
    total_samples = int(total_sec * SAMPLE_RATE)
    left = [0.0] * total_samples
    right = [0.0] * total_samples
    
    freqs = [73.42, 110.0, 146.83, 220.0, 277.18]
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        val_l = 0.0
        val_r = 0.0
        for fi, f in enumerate(freqs):
            detune = 1.0 + 0.001 * math.sin(t * 0.25 + fi * 1.5)
            s = math.sin(2 * math.pi * f * t) * 0.6 + math.sin(2 * math.pi * (f * detune) * t) * 0.4
            pan = 0.5 + 0.3 * math.sin(t * 0.15 + fi)
            val_l += s * (1.0 - pan)
            val_r += s * pan
            
        left[i] = val_l * 0.45
        right[i] = val_r * 0.45
        
    cf_samples = int(CROSSFADE_SEC * SAMPLE_RATE)
    final_l = equal_power_crossfade(left, cf_samples)
    final_r = equal_power_crossfade(right, cf_samples)
    save_wav_and_encode_mp3(final_l, final_r, output_mp3 + '.wav', output_mp3)

# 7. Lluvia suave 1: Lluvia en la Ventana
def gen_lluvia_1(output_mp3):
    loop_duration = 12.0
    total_sec = loop_duration + CROSSFADE_SEC
    total_samples = int(total_sec * SAMPLE_RATE)
    left = [0.0] * total_samples
    right = [0.0] * total_samples
    
    b0_l, b1_l, b2_l, b3_l, b4_l, b5_l, b6_l = [0.0]*7
    b0_r, b1_r, b2_r, b3_r, b4_r, b5_r, b6_r = [0.0]*7
    import random
    rng = random.Random(42)
    
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        white_l = rng.uniform(-1.0, 1.0)
        white_r = rng.uniform(-1.0, 1.0)
        
        b0_l = 0.99886 * b0_l + white_l * 0.0555179
        b1_l = 0.99332 * b1_l + white_l * 0.0750759
        b2_l = 0.96900 * b2_l + white_l * 0.1538520
        b3_l = 0.86650 * b3_l + white_l * 0.3104856
        b4_l = 0.55000 * b4_l + white_l * 0.5329522
        b5_l = -0.7616 * b5_l - white_l * 0.0168980
        pink_l = b0_l + b1_l + b2_l + b3_l + b4_l + b5_l + b6_l + white_l * 0.5362
        b6_l = white_l * 0.115926
        
        b0_r = 0.99886 * b0_r + white_r * 0.0555179
        b1_r = 0.99332 * b1_r + white_r * 0.0750759
        b2_r = 0.96900 * b2_r + white_r * 0.1538520
        b3_r = 0.86650 * b3_r + white_r * 0.3104856
        b4_r = 0.55000 * b4_r + white_r * 0.5329522
        b5_r = -0.7616 * b5_r - white_r * 0.0168980
        pink_r = b0_r + b1_r + b2_r + b3_r + b4_r + b5_r + b6_r + white_r * 0.5362
        b6_r = white_r * 0.115926
        
        wind = 0.85 + 0.15 * math.sin(t * 0.6)
        drop = 0.0
        if rng.random() < 0.003:
            drop = rng.uniform(0.1, 0.25)
            
        left[i] = (pink_l * 0.12 + drop) * wind
        right[i] = (pink_r * 0.12 + drop * 0.7) * wind
        
    cf_samples = int(CROSSFADE_SEC * SAMPLE_RATE)
    final_l = equal_power_crossfade(left, cf_samples)
    final_r = equal_power_crossfade(right, cf_samples)
    save_wav_and_encode_mp3(final_l, final_r, output_mp3 + '.wav', output_mp3)

# 8. Lluvia suave 2: Brisa y Gotas
def gen_lluvia_2(output_mp3):
    loop_duration = 12.0
    total_sec = loop_duration + CROSSFADE_SEC
    total_samples = int(total_sec * SAMPLE_RATE)
    left = [0.0] * total_samples
    right = [0.0] * total_samples
    
    b0_l, b1_l, b2_l, b0_r, b1_r, b2_r = [0.0]*6
    import random
    rng = random.Random(101)
    
    for i in range(total_samples):
        t = i / SAMPLE_RATE
        wl = rng.uniform(-1.0, 1.0)
        wr = rng.uniform(-1.0, 1.0)
        
        b0_l = 0.995 * b0_l + wl * 0.08
        b1_l = 0.95 * b1_l + wl * 0.15
        b0_r = 0.995 * b0_r + wr * 0.08
        b1_r = 0.95 * b1_r + wr * 0.15
        
        wind_mod = 0.7 + 0.3 * math.sin(2 * math.pi * (1.0 / 6.0) * t)
        left[i] = (b0_l + b1_l) * 0.2 * wind_mod
        right[i] = (b0_r + b1_r) * 0.2 * wind_mod
        
    cf_samples = int(CROSSFADE_SEC * SAMPLE_RATE)
    final_l = equal_power_crossfade(left, cf_samples)
    final_r = equal_power_crossfade(right, cf_samples)
    save_wav_and_encode_mp3(final_l, final_r, output_mp3 + '.wav', output_mp3)

if __name__ == '__main__':
    dest = 'audio/musica'
    os.makedirs(dest, exist_ok=True)
    print("Generating music loops...")
    gen_concentracion_1(os.path.join(dest, 'concentracion_1_pulso_alfa.mp3'))
    gen_concentracion_2(os.path.join(dest, 'concentracion_2_flujo_continuo.mp3'))
    gen_relax_1(os.path.join(dest, 'relax_1_ondas_de_calma.mp3'))
    gen_relax_2(os.path.join(dest, 'relax_2_serenidad_acustica.mp3'))
    gen_noche_1(os.path.join(dest, 'noche_1_penumbra_serena.mp3'))
    gen_noche_2(os.path.join(dest, 'noche_2_nebulosa_estelar.mp3'))
    gen_lluvia_1(os.path.join(dest, 'lluvia_1_lluvia_ventana.mp3'))
    gen_lluvia_2(os.path.join(dest, 'lluvia_2_brisa_y_gotas.mp3'))
    print("All music tracks generated successfully!")
