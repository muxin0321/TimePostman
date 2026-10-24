import { curves } from '@kit.ArkUI';

@Component
export struct WorkflowSteps {
  @Prop active: number = 0;

  private stepBackground(index: number): Resource {
    if (index < this.active) return $r('app.color.success');
    if (index === this.active) return $r('app.color.accent');
    return $r('app.color.surface_soft');
  }

  private stepNumberColor(index: number): Resource {
    return index <= this.active ? $r('app.color.on_accent') : $r('app.color.text_faint');
  }

  private stepLabelColor(index: number): Resource {
    if (index === this.active) return $r('app.color.text_primary');
    if (index < this.active) return $r('app.color.success');
    return $r('app.color.text_faint');
  }

  @Builder
  private step(index: number, label: string) {
    Column({ space: 5 }) {
      Text(`${index + 1}`)
        .width(24)
        .height(24)
        .textAlign(TextAlign.Center)
        .fontSize(11)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.stepNumberColor(index))
        .backgroundColor(this.stepBackground(index))
        .borderRadius(12)
        .scale({ x: index === this.active ? 1.1 : 1, y: index === this.active ? 1.1 : 1 })
        .animation({ duration: 280, curve: curves.springMotion(0.28, 0.78) })
      Text(label)
        .fontSize(10)
        .fontColor(this.stepLabelColor(index))
        .fontWeight(index === this.active ? FontWeight.Medium : FontWeight.Normal)
        .animation({ duration: 260, curve: curves.springMotion(0.26, 0.8) })
    }
    .layoutWeight(1)
  }

  build() {
    Row({ space: 2 }) {
      this.step(0, '连接')
      this.step(1, '上传')
      this.step(2, '接收')
      this.step(3, '保存')
    }
    .width('100%')
    .padding({ left: 8, right: 8, top: 10, bottom: 10 })
    .backgroundColor($r('app.color.surface'))
    .borderRadius(28)
    .border({ width: 1, color: $r('app.color.border') })
  }
}
