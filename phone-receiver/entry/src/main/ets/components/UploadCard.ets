@Component
export struct UploadCard {
  @Prop uploading: boolean = false;
  @Prop uploadProgress: number = 0;
  onUpload: () => void = () => {};

  build() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text('1')
          .width(24)
          .height(24)
          .textAlign(TextAlign.Center)
          .fontSize(13)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFF')
          .backgroundColor('#2F6FED')
          .borderRadius(12)
        Text('上传照片或视频')
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor('#162033')
      }
      .width('100%')
      Text('选择 1-50 个文件上传到电脑，然后到电脑网页点“手机传入”并设置目标日期。单个文件上限 300MB。')
        .fontSize(12)
        .fontColor('#667085')
      Button(this.uploading ? `上传中 ${this.uploadProgress}%` : '选择照片/视频并上传')
        .onClick(() => {
          this.onUpload();
        })
        .enabled(!this.uploading)
        .width('100%')
    }
    .width('100%')
    .padding(16)
    .backgroundColor('#FFFFFF')
    .borderRadius(14)
    .alignItems(HorizontalAlign.Start)
  }
}
