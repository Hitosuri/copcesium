import * as Cesium from 'cesium';
import { Viewer } from 'resium';
import ViewerContent from './ViewerContent';
import './App.css';

Cesium.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_TOKEN ?? '';

export default function App() {
  return (
    <Viewer
      full
      terrain={Cesium.Terrain.fromWorldTerrain()}
      requestRenderMode
      baseLayerPicker={false}
      sceneModePicker={false}
      animation={false}
      timeline={false}
      geocoder={false}
      homeButton={false}
      navigationHelpButton={false}
      fullscreenButton={false}
    >
      <ViewerContent />
    </Viewer>
  );
}
