export function getGraph(): Promise<{
    "@context": {
        "@base": string;
        "@vocab": string;
        skos: string;
        xsd: string;
        Session: string;
        View: string;
        Event: string;
        Cookie: string;
        User: string;
        Post: string;
        Documentation: string;
        Concept: string;
        Domain: {
            "@id": string;
            "@type": string;
        };
        domain: string;
        event: string;
        id: string;
        type: string;
        browser: string;
        browserVersion: string;
        os: string;
        from: string;
        referrer: string;
        url: string;
        manages: {
            "@id": string;
            "@type": string;
        };
        managedBy: {
            "@id": string;
            "@type": string;
        };
        organizations: string;
        attachedTo: {
            "@id": string;
            "@type": string;
        };
        loginTime: {
            "@id": string;
            "@type": string;
        };
        created: {
            "@id": string;
            "@type": string;
        };
        expires: {
            "@id": string;
            "@type": string;
        };
        source: {
            "@id": string;
            "@type": string;
        };
        events: {
            "@reverse": string;
        };
        viewed: {
            "@id": string;
            "@type": string;
        };
        viewedPage: {
            "@id": string;
        };
        width: {
            "@id": string;
            "@type": string;
        };
        datetime: {
            "@id": string;
            "@type": string;
        };
        timestamp: {
            "@id": string;
            "@type": string;
        };
        duration: {
            "@id": string;
            "@type": string;
        };
        inSession: {
            "@id": string;
        };
        name: {
            "@id": string;
            "@type": string;
        };
        canonical: {
            "@id": string;
            "@type": string;
        };
        title: {
            "@id": string;
            "@type": string;
        };
        author: {
            "@id": string;
            "@type": string;
        };
        authorOf: {
            "@reverse": string;
        };
        subject: {
            "@id": string;
            "@type": string;
        };
        subjectOf: {
            "@reverse": string;
        };
        published: {
            "@id": string;
            "@type": string;
        };
        lastUpdated: {
            "@id": string;
            "@type": string;
        };
        introduces: {
            "@id": string;
            "@type": string;
        };
        introducedBy: {
            "@reverse": string;
        };
        mentions: {
            "@id": string;
            "@type": string;
        };
        mentionedBy: {
            "@reverse": string;
        };
        references: {
            "@id": string;
            "@type": string;
        };
        referencedBy: {
            "@reverse": string;
        };
        abstract: {
            "@id": string;
            "@type": string;
        };
        previous: {
            "@id": string;
            "@type": string;
        };
        next: {
            "@reverse": string;
        };
        hasPart: {
            "@id": string;
            "@type": string;
        };
        partOf: {
            "@reverse": string;
        };
        fragment: {
            "@id": string;
            "@type": string;
        };
        prefLabel: string;
        altLabel: string;
        hiddenLabel: string;
        definition: string;
        broaderThan: string;
        narrowerThan: {
            "@reverse": string;
        };
        description: {
            "@id": string;
            "@type": string;
        };
        fullname: {
            "@id": string;
            "@type": string;
        };
        rel: {
            "@id": string;
            "@type": string;
        };
        href: {
            "@id": string;
            "@type": string;
        };
        Project: string;
        projects: {
            "@id": string;
            "@type": string;
        };
        secretKey: {
            "@id": string;
            "@type": string;
        };
        publicKey: {
            "@id": string;
            "@type": string;
        };
        endpoint: {
            "@id": string;
            "@type": string;
        };
    };
    "@graph": any[];
}>;
export function getFramed(query: any): Promise<any>;
