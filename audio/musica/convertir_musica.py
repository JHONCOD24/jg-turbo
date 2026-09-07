import os
import glob
import subprocess
import json

src_dir = 'Fondos Musicales'
dst_dir = os.path.join('audio', 'musica')
os.makedirs(dst_dir, exist_ok=True)

test_f = os.path.join(dst_dir, 'test_deep_work_flow.mp3')
if os.path.exists(test_f):
    os.remove(test_f)

pistas = [
    {
        'src_name': 'Deep Work Flow.wav',
        'filename': 'concentracion_deep_work_flow.mp3',
        'id': 'concentracion_deep_work_flow',
        'animo': 'concentracion',
        'nombre': 'Deep Work Flow',
        'desc': 'Pulso ambiental armónico para entrar en estado de flujo profundo'
    },
    {
        'src_name': 'Hypnotic Pulse.wav',
        'filename': 'concentracion_hypnotic_pulse.mp3',
        'id': 'concentracion_hypnotic_pulse',
        'animo': 'concentracion',
        'nombre': 'Hypnotic Pulse',
        'desc': 'Ritmo envolvente y constante que estimula la concentración activa'
    },
    {
        'src_name': 'Resonant Mind.wav',
        'filename': 'concentracion_resonant_mind.mp3',
        'id': 'concentracion_resonant_mind',
        'animo': 'concentracion',
        'nombre': 'Resonant Mind',
        'desc': 'Resonancia acústica suave para estudio intensivo y retención'
    },
    {
        'src_name': 'Felt & Cello.wav',
        'filename': 'relax_felt_and_cello.mp3',
        'id': 'relax_felt_and_cello',
        'animo': 'relax',
        'nombre': 'Felt & Cello',
        'desc': 'Piano acústico aterciopelado y violonchelo cálido y reflexivo'
    },
    {
        'src_name': 'Quiet Pages.wav',
        'filename': 'relax_quiet_pages.mp3',
        'id': 'relax_quiet_pages',
        'animo': 'relax',
        'nombre': 'Quiet Pages',
        'desc': 'Atmósfera sosegada ideal para lectura de novelas y ensayos'
    },
    {
        'src_name': 'Reading Space.wav',
        'filename': 'relax_reading_space.mp3',
        'id': 'relax_reading_space',
        'animo': 'relax',
        'nombre': 'Reading Space',
        'desc': 'Espacio sonoro abierto y luminoso para despejar la mente'
    },
    {
        'src_name': 'Still Waters Spa.wav',
        'filename': 'relax_still_waters_spa.mp3',
        'id': 'relax_still_waters_spa',
        'animo': 'relax',
        'nombre': 'Still Waters Spa',
        'desc': 'Acordes armónicos cristalinos y relajación profunda antiestrés'
    },
    {
        'src_name': 'Late Hours.wav',
        'filename': 'noche_late_hours.mp3',
        'id': 'noche_late_hours',
        'animo': 'noche',
        'nombre': 'Late Hours',
        'desc': 'Tonos aterciopelados y descanso visual para leer en la noche'
    },
    {
        'src_name': 'Slow Waves.wav',
        'filename': 'noche_slow_waves.mp3',
        'id': 'noche_slow_waves',
        'animo': 'noche',
        'nombre': 'Slow Waves',
        'desc': 'Ondas lentas y frecuencias bajas para inducir el reposo'
    },
    {
        'src_name': 'Gentle Window Rain.wav',
        'filename': 'lluvia_gentle_window_rain.mp3',
        'id': 'lluvia_gentle_window_rain',
        'animo': 'lluvia',
        'nombre': 'Gentle Window Rain',
        'desc': 'Lluvia constante y apacible golpeando suavemente el cristal'
    },
    {
        'src_name': 'Rain & Felt Piano.wav',
        'filename': 'lluvia_rain_and_felt_piano.mp3',
        'id': 'lluvia_rain_and_felt_piano',
        'animo': 'lluvia',
        'nombre': 'Rain & Felt Piano',
        'desc': 'Fusión reconfortante de gotas de lluvia y piano suave'
    }
]

catalogo_js = []
total_bytes = 0

for p in pistas:
    src_path = os.path.join(src_dir, p['src_name'])
    dst_path = os.path.join(dst_dir, p['filename'])
    
    cmd_dur = ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', src_path]
    r_dur = subprocess.run(cmd_dur, capture_output=True, text=True)
    d_data = json.loads(r_dur.stdout)
    dur = float(d_data['format']['duration'])
    mins = int(dur // 60)
    secs = int(dur % 60)
    dur_str = f'{mins}:{secs:02d}'
    
    fade_out_st = max(0.0, dur - 2.0)
    af_filter = f'afade=t=in:ss=0:d=1.5,afade=t=out:st={fade_out_st:.2f}:d=2.0'
    
    cmd_enc = [
        'ffmpeg', '-y', '-i', src_path,
        '-af', af_filter,
        '-ar', '44100', '-b:a', '160k',
        dst_path
    ]
    subprocess.run(cmd_enc, check=True, capture_output=True)
    
    sz = os.path.getsize(dst_path)
    total_bytes += sz
    print(f"Encoded {p['filename']}: {dur_str} ({sz / (1024*1024):.2f} MB)")
    
    catalogo_js.append({
        'id': p['id'],
        'animo': p['animo'],
        'nombre': p['nombre'],
        'duracion': dur_str,
        'duracionSeg': round(dur, 2),
        'desc': p['desc'],
        'src': f"/audio/musica/{p['filename']}"
    })

print(f"\nTotal encoded size: {total_bytes / (1024*1024):.2f} MB across {len(pistas)} tracks.")
with open(os.path.join(dst_dir, 'catalogo.json'), 'w', encoding='utf-8') as f:
    json.dump(catalogo_js, f, indent=2, ensure_ascii=False)
