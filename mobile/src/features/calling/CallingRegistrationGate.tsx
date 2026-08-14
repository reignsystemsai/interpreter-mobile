import { useEffect, useState } from 'react';

import { getLocalCallableIdentity } from './CallableIdentity';
import { CallingSetup } from './CallingSetup';

export function CallingRegistrationGate() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let active = true;
    void getLocalCallableIdentity().then((identity) => {
      if (active) setVisible(!identity);
    });
    return () => { active = false; };
  }, []);

  return <CallingSetup onCancel={() => undefined} onComplete={() => setVisible(false)} required visible={visible} />;
}
