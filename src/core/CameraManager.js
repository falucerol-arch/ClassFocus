export class CameraManager {
  constructor(videoElement) {
    this.videoElement = videoElement
    this.stream = null
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Tu navegador no permite acceso a la cámara.')
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    })

    this.videoElement.srcObject = this.stream
    await this.videoElement.play()
    return this.stream
  }

  stop() {
    this.stream?.getTracks().forEach(track => track.stop())
    if (this.videoElement) this.videoElement.srcObject = null
    this.stream = null
  }
}
