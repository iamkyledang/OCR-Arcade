export interface BBox {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

export interface FoundationResult {
    boxes: BBox[];
    name: string;
    description: string;
}

export interface IOcrFoundation {
    name: string;
    description: string;
    detect(imageData: ImageData, vertical?: boolean): Promise<BBox[]>;
}
