"""Run real recordings against a deployed model; standard library only."""
import argparse
import base64
import concurrent.futures
import json
import time
import urllib.request
import wave


def read_pcm(path, samples, require_full=False):
    with wave.open(path, 'rb') as audio:
        if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (16000, 1, 2):
            raise ValueError('Expected 16000Hz mono PCM16 WAV')
        pcm = audio.readframes(samples)
    if len(pcm) < 6400 or (require_full and len(pcm) != samples * 2):
        raise ValueError('Reference needs >=200ms; candidate needs >=1024ms')
    return base64.b64encode(pcm).decode()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default='http://127.0.0.1:8008')
    parser.add_argument('--reference', required=True)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--concurrency', type=int, default=4)
    args = parser.parse_args()
    if not 1 <= args.concurrency <= 64:
        parser.error('concurrency must be 1–64')

    def post(path, data):
        request = urllib.request.Request(args.base_url.rstrip('/') + path,
            data=json.dumps(data).encode(), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)

    reference = post('/v1/embedding', {'pcm_base64': read_pcm(args.reference, 24000), 'sample_rate': 16000})
    candidate = read_pcm(args.candidate, 16384, require_full=True)

    def verify(index):
        start = time.monotonic()
        result = post('/v1/verify', {'pcm_base64': candidate, 'sample_rate': 16000,
                                    'reference_embedding': reference['embedding']})
        return {'request': index, 'elapsed_ms': round((time.monotonic() - start) * 1000),
                'matched': result['matched'], 'score': result['score'], 'threshold': result['threshold']}

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        for result in pool.map(verify, range(args.concurrency)):
            print(json.dumps(result))


if __name__ == '__main__':
    main()
